import asyncio
import base64
import json
import logging
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from auth import validate_token
from config import get_workspace_path, settings
from services.agent_runner import AgentRunner, list_agents, list_opencode_models
from services import session_store

logger = logging.getLogger(__name__)
router = APIRouter()

# Wrap the raw websocket so every event we send is also persisted to the session.
class PersistingSocket:
    def __init__(self, websocket, session_id: str):
        self._ws = websocket
        self._session_id = session_id

    async def send_json(self, data: dict):
        await self._ws.send_json(data)
        try:
            _persist_event(self._session_id, data)
        except Exception:
            pass

    @property
    def client_state(self):
        return self._ws.client_state


def _persist_event(session_id: str, data: dict):
    etype = data.get("type", "")
    if etype in ("thinking", "stdout", "stderr", "text"):
        session_store.add_message(
            session_id, "agent", etype if etype == "thinking" else "terminal",
            content=data.get("content", ""),
        )
    elif etype == "file_mod":
        session_store.add_message(
            session_id, "agent", "diff",
            file_path=data.get("file", ""), diff=data.get("diff", ""),
        )
    elif etype == "done":
        session_store.add_message(
            session_id, "agent", "text", content=data.get("response", ""),
        )
    elif etype == "error":
        session_store.add_message(
            session_id, "system", "error", content=data.get("content", ""),
        )


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

    # Create or resume session
    if session_id:
        session = session_store.get_session(session_id)
        if not session:
            session = session_store.create_session(
                project=project, engine=engine, agent=agent, model=model
            )
            session_id = session["id"]
        else:
            engine = session.get("engine", engine)
            agent = session.get("agent", agent)
            model = session.get("model", model)
            session_store.update_session(session_id, updated_at=__import__("time").time())
    else:
        session = session_store.create_session(
            project=project, engine=engine, agent=agent, model=model
        )
        session_id = session["id"]

    # Replay history on reconnect
    history = session_store.get_messages(session_id, limit=200)
    pws = PersistingSocket(websocket, session_id)
    if history:
        await pws.send_json({"type": "history", "session_id": session_id, "messages": history})

    agent_runner = AgentRunner(
        str(project_path), engine=engine, agent=agent, model=model
    )
    run_id = None
    pending_attachments: list[dict] = []

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            mtype = message.get("type", "")

            if mtype == "attachment":
                # {type:'attachment', name, mime, data(base64)}
                saved = _save_attachment(
                    session_id, message.get("name", "file"),
                    message.get("data", ""), message.get("mime", ""),
                )
                if not saved.get("ok"):
                    await pws.send_json({"type": "error", "content": "Failed to save attachment: " + saved.get("error", "unknown")})
                    continue
                # Record as a user message with type attachment
                extra = json.dumps({"name": saved["name"], "url": saved["url"], "mime": saved["mime"], "is_image": saved["is_image"]})
                session_store.add_message(
                    session_id, "user", "attachment",
                    content=f"📎 {saved['name']}", extra=extra,
                )
                # Keep it pending to attach to the next prompt
                pending_attachments.append({
                    "path": saved["path"], "name": saved["name"],
                    "mime": saved["mime"], "is_image": saved["is_image"],
                })
                await pws.send_json({"type": "attachment_ok", "name": saved["name"], "url": saved["url"], "is_image": saved["is_image"]})
                continue

            elif mtype == "prompt":
                if agent_runner.task is not None and not agent_runner.task.done():
                    await pws.send_json({"type": "error", "content": "Agent is already running. Send cancel to abort it."})
                    continue
                prompt = message.get("content", "").strip()
                if not prompt and not pending_attachments:
                    continue

                # Persist user message
                session_store.add_message(session_id, "user", "text", content=prompt)

                # Attach pending files/images into the prompt context
                if pending_attachments:
                    attach_text = "\n\nAttached files:\n" + "\n".join(
                        f"- {a['name']} ({a['mime']}) at {a['path']}"
                        for a in pending_attachments
                    )
                    prompt = (prompt + attach_text).strip()
                    pending_attachments = []

                # Current engine/agent may be sent per-prompt
                cur_engine = message.get("engine", engine)
                cur_agent = message.get("agent", agent)
                cur_model = message.get("model", model)

                run_id = session_store.start_agent_run(
                    session_id, prompt, cur_engine, cur_agent, cur_model
                )
                session_store.update_session(
                    session_id, engine=cur_engine, agent=cur_agent, model=cur_model
                )

                agent_runner.engine = cur_engine
                agent_runner.agent = cur_agent
                agent_runner.model = cur_model

                agent_runner.task = asyncio.create_task(
                    _run_guarded(agent_runner, prompt, pws, run_id)
                )

            elif mtype == "cancel":
                agent_runner.cancel()
                if run_id:
                    session_store.finish_agent_run(run_id, "cancelled")
                await pws.send_json({"type": "thinking", "content": "Cancelling agent..."})

            elif mtype == "set_engine":
                engine = message.get("engine", engine)
                agent = message.get("agent", agent)
                model = message.get("model", model)
                agent_runner.engine = engine
                agent_runner.agent = agent
                agent_runner.model = model

    except WebSocketDisconnect:
        agent_runner.cancel()
        if run_id:
            session_store.finish_agent_run(run_id, "cancelled")
        logger.info("Client disconnected from project %s", project)
    except Exception as exc:
        agent_runner.cancel()
        if run_id:
            session_store.finish_agent_run(run_id, "failed")
        logger.warning("WS error for project %s: %s", project, exc)
        try:
            await pws.send_json({"type": "error", "content": str(exc)})
            await websocket.close(code=1011)
        except Exception:
            pass


async def _run_guarded(runner: AgentRunner, prompt: str, pws, run_id: str):
    """Run the agent and update the agent_runs row on completion."""
    try:
        await runner.run_prompt(prompt, pws)
        session_store.finish_agent_run(run_id, "completed")
    except asyncio.CancelledError:
        session_store.finish_agent_run(run_id, "cancelled")
        raise
    except Exception:
        session_store.finish_agent_run(run_id, "failed")
        raise
