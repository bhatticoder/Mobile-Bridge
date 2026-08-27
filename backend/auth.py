import secrets
import threading
import time

from fastapi import Request

from config import settings

_sessions: dict[str, float] = {}
_lock = threading.Lock()


def _verify_pin(pin: str) -> bool:
    if not settings.AUTH_PIN:
        return False
    return secrets.compare_digest(pin or "", settings.AUTH_PIN)


def issue_token() -> str:
    token = secrets.token_urlsafe(48)
    with _lock:
        _cleanup()
        _sessions[token] = time.time() + settings.SESSION_TTL_HOURS * 3600
    return token


def validate_token(token: str | None) -> bool:
    if not token:
        return False
    with _lock:
        exp = _sessions.get(token)
        if exp is None:
            return False
        if time.time() > exp:
            _sessions.pop(token, None)
            return False
    return True


def revoke_token(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)


def _cleanup() -> None:
    now = time.time()
    for t in [k for k, exp in _sessions.items() if now > exp]:
        _sessions.pop(t, None)


def extract_bearer(request: Request) -> str:
    """Pull a token from the Authorization header or ?token= query param."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.query_params.get("token", "")


def require_auth(request: Request):
    """FastAPI dependency guarding protected routers."""
    from fastapi import HTTPException

    if validate_token(extract_bearer(request)):
        return True
    raise HTTPException(status_code=401, detail="Invalid or expired session token")