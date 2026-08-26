from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os

from config import get_workspace_path
from services.process_manager import process_manager

router = APIRouter()

class StartCommandReq(BaseModel):
    project_name: str
    command: str

class ProjectReq(BaseModel):
    project_name: str

@router.post("/start")
def start_dev_server(req: StartCommandReq):
    ws_path = get_workspace_path()
    project_path = ws_path / req.project_name
    
    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
        
    success = process_manager.start_process(req.project_name, str(project_path), req.command)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to start process or already running")
        
    return {"status": "success", "message": f"Started {req.command} for {req.project_name}"}

@router.post("/stop")
def stop_dev_server(req: ProjectReq):
    success = process_manager.stop_process(req.project_name)
    if not success:
        return {"status": "skipped", "message": "No process running"}
    return {"status": "success", "message": f"Stopped process for {req.project_name}"}

@router.get("/status")
def dev_server_status(project_name: str):
    return process_manager.get_status(project_name)

@router.get("/logs")
def dev_server_logs(project_name: str, count: int = 50):
    logs = process_manager.get_recent_logs(project_name, count)
    return {"logs": logs}
