import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json
import logging

from auth import validate_token
from config import get_workspace_path
from services.agent_runner import AgentRunner

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/prompt")
async def websocket_prompt(websocket: WebSocket, project: str, token: str = ""):
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

    agent = AgentRunner(str(project_path))

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            mtype = message.get("type", "")

            if mtype == "prompt":
                if agent.task is not None and not agent.task.done():
                    await websocket.send_json({"type": "error", "content": "Agent is already running. Send cancel to abort it."})
                    continue
                prompt = message.get("content", "").strip()
                if not prompt:
                    continue
                agent.task = asyncio.create_task(agent.run_prompt(prompt, websocket))
            elif mtype == "cancel":
                agent.cancel()
                await websocket.send_json({"type": "thinking", "content": "Cancelling agent..."})

    except WebSocketDisconnect:
        agent.cancel()
        logger.info("Client disconnected from project %s", project)
    except Exception as exc:  # pragma: no cover
        agent.cancel()
        logger.warning("WS error for project %s: %s", project, exc)
        try:
            await websocket.send_json({"type": "error", "content": str(exc)})
            await websocket.close(code=1011)
        except Exception:
            pass