import os
import subprocess
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import time

from config import get_workspace_path

router = APIRouter()

class ProjectInfo(BaseModel):
    name: str
    path: str
    last_modified: float
    git_branch: Optional[str] = None
    git_status: Optional[str] = None

class CreateProjectReq(BaseModel):
    name: str
    repo_url: Optional[str] = None

def get_git_info(path: str):
    branch = None
    status = None
    if os.path.exists(os.path.join(path, ".git")):
        try:
            branch_cmd = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=path, capture_output=True, text=True, check=True)
            branch = branch_cmd.stdout.strip()
            
            status_cmd = subprocess.run(["git", "status", "-s"], cwd=path, capture_output=True, text=True, check=True)
            status = "Clean" if not status_cmd.stdout.strip() else "Dirty"
        except Exception:
            pass
    return branch, status

@router.get("", response_model=List[ProjectInfo])
def list_projects():
    ws_path = get_workspace_path()
    
    if not ws_path.exists():
        ws_path.mkdir(parents=True, exist_ok=True)
        
    projects = []
    for entry in os.scandir(ws_path):
        if entry.is_dir() and not entry.name.startswith("."):
            branch, status = get_git_info(entry.path)
            projects.append(ProjectInfo(
                name=entry.name,
                path=entry.path,
                last_modified=entry.stat().st_mtime,
                git_branch=branch,
                git_status=status
            ))
            
    # Sort by last modified descending
    projects.sort(key=lambda x: x.last_modified, reverse=True)
    return projects

@router.post("/create")
def create_project(req: CreateProjectReq):
    ws_path = get_workspace_path()
    project_path = ws_path / req.name
    
    if project_path.exists():
        raise HTTPException(status_code=400, detail="Project already exists")
        
    try:
        if req.repo_url:
            subprocess.run(["git", "clone", req.repo_url, req.name], cwd=str(ws_path), check=True)
        else:
            project_path.mkdir(parents=True, exist_ok=True)
        return {"status": "success", "message": f"Project {req.name} created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
