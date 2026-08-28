from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from config import settings

# Served WITHOUT auth so an <img> tag can load chat images.
# Access is protected by the unguessable session_id + filename only.
router = APIRouter()


def _attachment_path(session_id: str, filename: str) -> Path:
    data_dir = Path(settings.DATA_DIR or (Path(__file__).resolve().parent.parent / "data"))
    base = (data_dir / "attachments" / session_id).resolve()
    fpath = (base / filename).resolve()
    if str(fpath).startswith(str(base)):
        return fpath
    return Path("__invalid__")


@router.get("/{session_id}/{filename}")
def api_get_attachment(session_id: str, filename: str):
    fpath = _attachment_path(session_id, filename)
    if fpath.exists() and fpath.is_file():
        return FileResponse(str(fpath))
    raise HTTPException(404, "Attachment not found")
