from fastapi import APIRouter

from services.tunnel_manager import tunnel_manager

router = APIRouter(prefix="/api/tunnel", tags=["Tunnel"])


@router.get("/status")
def tunnel_status():
    return tunnel_manager.status()


@router.get("/logs")
def tunnel_logs(count: int = 60):
    return {"logs": tunnel_manager.logs(count)}


@router.post("/start")
def tunnel_start():
    return tunnel_manager.start()


@router.post("/stop")
def tunnel_stop():
    return tunnel_manager.stop()