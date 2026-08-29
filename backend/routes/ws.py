import asyncio
import base64
import json
import logging
import time
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from auth import validate_token
from config import get_workspace_path, settings
from services.agent_runner import list_agents, list_opencode_models
from services import run_manager, session_store

logger = logging.getLogger(__name__)
router = APIRouter()


def _save_attachment(session_id: str, filename: str, data_b64: str, mime: str) -> dict:
    """Persist an uploaded file/image to disk and return its metadata."""
    data_dir = Path(settings.DATA_DIR or (Path(__file__).resolve().parent.parent / "data"))
    att_dir = data_dir / "attachments" / session_id
    att_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(filename).name or "file"
    target = att_dir / safe_name
    try:
        raw = base64.b64decode(data_b64)
        target.write_bytes(raw)
    except Exception as exc:
        logger.warning("Failed to save attachment %s: %s", filename, exc)
        return {"ok": False, "error": str(exc)}
    is_image = mime.startswith("image/")
    return {
        "ok": True,
        "name": safe_name,
        "path": str(target),
        "mime": mime,
        "is_image": is_image,
        "url": f"/attachments/{session_id}/{safe_name}",
        "size": len(raw),
    }


@router.get("/agents")
def ws_agents():
    """List available agents across both engines."""
    ag_agents = list_agents()
    oc_models = list_opencode_models()
    return {
        "antigravity": ag_agents,
        "opencode": [{"id": m["id"], "name": m["name"], "engine": "opencode"} for m in oc_models],
    }


@router.websocket("/prompt")
async def websocket_prompt(
    websocket: WebSocket,
    project: str,
    token: str = "",
    session_id: str = "",
    engine: str = "antigravity",
    agent: str = "code-fixer",
    model: str = "",
):
    await websocket.accept()

    if not validate_token(token):
        await websocket.send_json({"type": "error", "content": "Invalid or expired session token"})
        await websocket.close(code=1008)
        return

    ws_path = get_workspace_path()
    project_path = ws_path / project

    if not project_path.exists() or not project_path.is_dir():
        await websocket.send_json({"type": "error", "content": "Project not found"})
        await websocket.close(code=1011)
        return

    # We only materialize a DB session once a chat actually starts (first
    # prompt or attachment). Connecting with an empty session_id must NOT
    # create a session, otherwise every page load/agent switch spams the
    # history with phantom empty chats.
    session = None
    session_id = session_id or ""
    if session_id:
        session = session_store.get_session(session_id)
        if session:
            engine = session.get("engine", engine)
            agent = session.get("agent", agent)
            model = session.get("model", model)
        else:
            session_id = ""

    # Get or keep-alive the daemon-side run for this session. Only exists
    # once the session is materialized (usually right after a prompt).
    run = run_manager.get_run(session_id) if session_id else None
    if session is not None:
        if run is None or run.project_path != str(project_path):
            run = run_manager.create_run(
                session_id, str(project_path),
                engine=engine, agent=agent, model=model,
                oc_session_id=session.get("oc_session_id", ""),
            )
        else:
            run.runner.engine = engine
            run.runner.agent = agent
            run.runner.model = model
            run.runner.oc_session_id = session.get("oc_session_id", "")
        run.subscribe(websocket)

        # Replay history on reconnect so refresh keeps everything.
        history = session_store.get_messages(session_id, limit=200)
        if history:
            await websocket.send_json({"type": "history", "session_id": session_id, "messages": history})
        else:
            await websocket.send_json({"type": "session", "session_id": session_id})

        # Tell the client the current run state. If a run is active the client
        # should keep receiving live events; if one finished while disconnected,
        # tell it the outcome so it can stop spinners.
        if run.is_running():
            await websocket.send_json({
                "type": "running", "run_id": run.run_id,
                "session_id": session_id,
            })
        else:
            last_run = session_store.get_last_run(session_id)
            if last_run and last_run["status"] in ("completed", "cancelled", "failed"):
                await websocket.send_json({
                    "type": "run_status", "status": last_run["status"],
                    "session_id": session_id,
                })

    periodic = asyncio.create_task(_heartbeat(websocket))

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            mtype = message.get("type", "")

            if mtype == "attachment":
                # Attachment starts the chat too (it's the first real content).
                if session is None:
                    session = session_store.create_session(
                        project=project, engine=engine, agent=agent, model=model
                    )
                    session_id = session["id"]
                    run = run_manager.create_run(
                        session_id, str(project_path),
                        engine=engine, agent=agent, model=model,
                    )
                    run.subscribe(websocket)
                    await websocket.send_json({"type": "session", "session_id": session_id})
                saved = _save_attachment(
                    session_id, message.get("name", "file"),
                    message.get("data", ""), message.get("mime", ""),
                )
                if not saved.get("ok"):
                    await websocket.send_json({"type": "error", "content": "Failed to save attachment: " + saved.get("error", "unknown")})
                    continue
                extra = json.dumps({"name": saved["name"], "url": saved["url"], "mime": saved["mime"], "is_image": saved["is_image"]})
                session_store.add_message(
                    session_id, "user", "attachment",
                    content=f"📎 {saved['name']}", extra=extra,
                )
                run.pending_attachments.append({
                    "path": saved["path"], "name": saved["name"],
                    "mime": saved["mime"], "is_image": saved["is_image"],
                })
                await websocket.send_json({"type": "attachment_ok", "name": saved["name"], "url": saved["url"], "is_image": saved["is_image"]})
                continue

            elif mtype == "prompt":
                # First real prompt materializes the session + run.
                if session is None:
                    session = session_store.create_session(
                        project=project, engine=engine, agent=agent, model=model
                    )
                    session_id = session["id"]
                    run = run_manager.create_run(
                        session_id, str(project_path),
                        engine=engine, agent=agent, model=model,
                    )
                    run.subscribe(websocket)
                    await websocket.send_json({"type": "session", "session_id": session_id})
                if run.is_running():
                    await websocket.send_json({"type": "error", "content": "Agent is already running."})
                    continue
                prompt = message.get("content", "").strip()
                if not prompt and not run.pending_attachments:
                    continue

                # Persist user message + auto-title conversation
                session_store.add_message(session_id, "user", "text", content=prompt)
                session_store.ensure_title(session_id, prompt)
                session_store.update_session(session_id, updated_at=time.time())

                # Attach pending files/images into the prompt context
                if run.pending_attachments:
                    attach_text = "\n\nAttached files:\n" + "\n".join(
                        f"- {a['name']} ({a['mime']}) at {a['path']}"
                        for a in run.pending_attachments
                    )
                    prompt = (prompt + attach_text).strip()
                    run.pending_attachments = []

                # Current engine/agent may be sent per-prompt
                cur_engine = message.get("engine", engine)
                cur_agent = message.get("agent", agent)
                cur_model = message.get("model", model)

                # Multi-turn context from prior messages
                history_ctx = session_store.get_conversation_context(session_id, max_msgs=8)

                session_store.update_session(
                    session_id, engine=cur_engine, agent=cur_agent, model=cur_model,
                    updated_at=time.time(),
                )
                oc_session_id = session_store.get_session(session_id).get("oc_session_id", "")

                run = run_manager.start_run(
                    session_id, str(project_path), prompt,
                    cur_engine, cur_agent, cur_model,
                    oc_session_id=oc_session_id, history_ctx=history_ctx,
                )
                run.subscribe(websocket)

            elif mtype == "cancel":
                if run is not None:
                    run.cancel()
                await websocket.send_json({"type": "thinking", "content": "Cancelling agent..."})

            elif mtype == "set_engine":
                engine = message.get("engine", engine)
                agent = message.get("agent", agent)
                model = message.get("model", model)
                if run is not None:
                    run.runner.engine = engine
                    run.runner.agent = agent
                    run.runner.model = model

    except WebSocketDisconnect:
        # IMPORTANT: do NOT cancel the run. It keeps running daemon-side and
        # events stay persisted; the client can reconnect any time.
        pass
    except Exception as exc:
        logger.warning("WS error for project %s: %s", project, exc)
        try:
            await websocket.send_json({"type": "error", "content": str(exc)})
        except Exception:
            pass
    finally:
        periodic.cancel()
        if run is not None:
            run.unsubscribe(websocket)
        logger.info("WS closed for project %s session %s", project, session_id or "pending")


async def _heartbeat(websocket: WebSocket):
    """Keep NAT/firewall paths alive across long-running agent turns."""
    try:
        while True:
            await asyncio.sleep(20)
            await websocket.send_json({"type": "ping"})
    except Exception:
        pass