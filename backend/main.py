from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from config import settings
from routes import projects, dev, ws

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Filter out benign CancelledError during Uvicorn shutdown on Python 3.14
class CancelledErrorFilter(logging.Filter):
    def filter(self, record):
        if record.exc_info:
            exc_type, exc_value, exc_traceback = record.exc_info
            if exc_type.__name__ == 'CancelledError':
                return False
        return True

logging.getLogger("uvicorn.error").addFilter(CancelledErrorFilter())

app = FastAPI(title="Antigravity Mobile Remote Controller")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple Auth Dependency
async def verify_pin(request: Request):
    # Check header or query param
    pin = request.headers.get("Authorization")
    if pin:
        if pin.startswith("Bearer "):
            pin = pin.split(" ")[1]
    else:
        pin = request.query_params.get("pin")
        
    if pin != settings.AUTH_PIN:
        raise HTTPException(status_code=401, detail="Invalid PIN")
    return True

# Include routers
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"], dependencies=[Depends(verify_pin)])
app.include_router(dev.router, prefix="/api/dev", tags=["Development"], dependencies=[Depends(verify_pin)])
app.include_router(ws.router, prefix="/ws") # WS auth handled in route

@app.get("/health")
def health_check():
    return {"status": "ok"}
