import os
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from config import get_workspace_path

router = APIRouter()


class FileInfo(BaseModel):
    name: str
    path: str  # relative to project root
    is_dir: bool
    size: int = 0


@router.get("/tree")
def file_tree(project: str, path: str = "", depth: int = 2):
    ws = get_workspace_path()
    root = ws / project
    if not root.exists() or not root.is_dir():
        raise HTTPException(404, "Project not found")
    target = root / path
    if not target.exists():
        raise HTTPException(404, "Path not found")
    items = _scan(target, root, depth)
    return {"project": project, "path": path, "items": items}


@router.get("/content")
def file_content(project: str, path: str):
    ws = get_workspace_path()
    fpath = ws / project / path
    if not fpath.exists() or not fpath.is_file():
        raise HTTPException(404, "File not found")
    if fpath.stat().st_size > 512_000:
        raise HTTPException(413, "File too large (>512KB)")
    try:
        text = fpath.read_text(errors="replace")
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"project": project, "path": path, "content": text, "size": fpath.stat().st_size}


_IGNORE = {".git", "node_modules", "__pycache__", ".venv", "venv",
           ".next", "dist", "build", ".cache", "vendor", ".idea", ".vscode"}


def _scan(dir_path: Path, root: Path, depth: int) -> list:
    if depth < 0:
        return []
    items = []
    try:
        for e in sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if e.name in _IGNORE or e.name.startswith("."):
                continue
            rel = str(e.relative_to(root))
            info = {"name": e.name, "path": rel, "is_dir": e.is_dir()}
            if e.is_file():
                try:
                    info["size"] = e.stat().st_size
                except OSError:
                    info["size"] = 0
            if e.is_dir() and depth > 0:
                info["children"] = _scan(e, root, depth - 1)
            items.append(info)
    except PermissionError:
        pass
    return items
