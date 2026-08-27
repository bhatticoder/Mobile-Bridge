from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from auth import _verify_pin, issue_token, revoke_token

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class LoginReq(BaseModel):
    pin: str


class LogoutReq(BaseModel):
    token: str = ""


@router.post("/login", summary="Exchange the PIN for a session token")
def login(req: LoginReq):
    if not _verify_pin(req.pin):
        raise HTTPException(status_code=401, detail="Invalid PIN")
    return {"token": issue_token()}


@router.post("/logout")
def logout(req: LogoutReq):
    if req.token:
        revoke_token(req.token)
    return {"status": "ok"}