from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json

from config import get_workspace_path, settings
from services.agent_runner import AgentRunner

router = APIRouter()

@router.websocket("/prompt")
async def websocket_prompt(websocket: WebSocket, project: str, pin: str):
    await websocket.accept()
    
    if pin != settings.AUTH_PIN:
        await websocket.send_json({"type": "error", "content": "Invalid authentication PIN"})
        await websocket.close(code=1008)
        return
        
    ws_path = get_workspace_path()
    project_path = ws_path / project
    
    if not project_path.exists():
        await websocket.send_json({"type": "error", "content": "Project not found"})
        await websocket.close(code=1011)
        return
        
    agent = AgentRunner(str(project_path))
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "prompt":
                prompt = message.get("content", "")
                # Run the agent (this could be a background task in a real app to allow cancelling)
                await agent.run_prompt(prompt, websocket)
                
    except WebSocketDisconnect:
        print(f"Client disconnected from project {project}")
    except Exception as e:
        await websocket.send_json({"type": "error", "content": str(e)})
        await websocket.close(code=1011)
