from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services import session_store

router = APIRouter()


class CreateSessionReq(BaseModel):
    project: str
    engine: str = "antigravity"
    agent: str = "code-fixer"
    model: str = ""
    title: str = ""


@router.post("")
def api_create_session(req: CreateSessionReq):
    s = session_store.create_session(
        project=req.project, engine=req.engine, agent=req.agent,
        model=req.model,
    )
    if req.title:
        session_store.update_session(s["id"], title=req.title)
        s["title"] = req.title
    return s


@router.get("")
def api_list_sessions(project: Optional[str] = None, limit: int = 50):
    return session_store.list_sessions(project=project, limit=limit)


@router.get("/{session_id}")
def api_get_session(session_id: str):
    s = session_store.get_session(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    return s


@router.get("/{session_id}/messages")
def api_get_messages(session_id: str, limit: int = 500):
    s = session_store.get_session(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    return session_store.get_messages(session_id, limit=limit)


@router.delete("/{session_id}")
def api_delete_session(session_id: str):
    session_store.delete_session(session_id)
    return {"status": "deleted"}


@router.patch("/{session_id}")
def api_update_session(session_id: str, body: dict):
    s = session_store.get_session(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    allowed = {"title", "engine", "agent", "model"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if updates:
        session_store.update_session(session_id, **updates)
    return session_store.get_session(session_id)
