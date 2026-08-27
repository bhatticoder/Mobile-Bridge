import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import logging

from config import settings
from auth import require_auth
from routes import projects, dev, ws, auth, tunnel
from services.tunnel_manager import tunnel_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class CancelledErrorFilter(logging.Filter):
    def filter(self, record):
        if record.exc_info:
            exc_type = record.exc_info[0]
            if exc_type.__name__ == "CancelledError":
                return False
        return True


logging.getLogger("uvicorn.error").addFilter(CancelledErrorFilter())


def resolve_frontend_dist() -> Optional[Path]:
    """Locate the built SPA. Priority: env override, bundled assets, source tree."""
    if settings.FRONTEND_DIST_DIR:
        p = Path(settings.FRONTEND_DIST_DIR).expanduser().resolve()
        if (p / "index.html").exists():
            return p
    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    else:
        meipass = Path(__file__).resolve().parent.parent
    for cand in (meipass / "frontend" / "dist", meipass / "web", meipass / "dist"):
        if (cand / "index.html").exists():
            return cand
    return None


frontend_dist = resolve_frontend_dist()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.TUNNEL_ENABLED and tunnel_manager.is_installed():
        info = tunnel_manager.start()
        logger.info("Tunnel auto-start: %s", info.get("status"))
    elif settings.TUNNEL_ENABLED:
        logger.warning("cloudflared not installed; skipping tunnel auto-start")
    yield
    tunnel_manager.stop()


app = FastAPI(
    title="Antigravity Mobile Remote Controller",
    lifespan=lifespan,
    docs_url="/docs" if frontend_dist is None else None,
    openapi_url="/openapi.json" if frontend_dist is None else None,
)

# CORS: the app is served same-origin in production and proxied in dev,
# so a restrictive policy is fine.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

protected = [Depends(require_auth)]

app.include_router(auth.router, tags=["Auth"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"], dependencies=protected)
app.include_router(dev.router, prefix="/api/dev", tags=["Development"], dependencies=protected)
app.include_router(tunnel.router, tags=["Tunnel"], dependencies=protected)
app.include_router(ws.router, prefix="/ws")  # WS auth handled in route


@app.get("/health")
def health_check():
    return {"status": "ok", "web": frontend_dist is not None}


if frontend_dist is not None:
    logger.info("Serving web frontend from %s", frontend_dist)
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="web")
else:
    logger.info("No built frontend found; API-only mode (use vite dev server).")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.HOST, port=settings.PORT)