import time
import uuid
from services.db import get_conn


def create_session(project: str, engine: str = "antigravity",
                   agent: str = "code-fixer", model: str = "") -> dict:
    sid = uuid.uuid4().hex[:12]
    now = time.time()
    get_conn().execute(
        "INSERT INTO sessions (id, project, engine, agent, model, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (sid, project, engine, agent, model, now, now),
    )
    get_conn().commit()
    return {"id": sid, "project": project, "engine": engine,
            "agent": agent, "model": model, "created_at": now, "updated_at": now}


def get_session(session_id: str) -> dict | None:
    row = get_conn().execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    return dict(row) if row else None


def list_sessions(project: str | None = None, limit: int = 50) -> list:
    if project:
        rows = get_conn().execute(
            "SELECT * FROM sessions WHERE project=? ORDER BY updated_at DESC LIMIT ?",
            (project, limit),
        ).fetchall()
    else:
        rows = get_conn().execute(
            "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def update_session(session_id: str, **kw) -> None:
    kw["updated_at"] = time.time()
    sets = ", ".join(f"{k}=?" for k in kw)
    get_conn().execute(f"UPDATE sessions SET {sets} WHERE id=?",
                       [*kw.values(), session_id])
    get_conn().commit()


def delete_session(session_id: str) -> None:
    get_conn().execute("DELETE FROM messages WHERE session_id=?", (session_id,))
    get_conn().execute("DELETE FROM agent_runs WHERE session_id=?", (session_id,))
    get_conn().execute("DELETE FROM sessions WHERE id=?", (session_id,))
    get_conn().commit()


def add_message(session_id: str, role: str, msg_type: str,
                content: str = "", file_path: str = "", diff: str = "",
                extra: str = "") -> dict:
    now = time.time()
    cur = get_conn().execute(
        "INSERT INTO messages (session_id, role, type, content, file_path, diff, extra, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (session_id, role, msg_type, content, file_path, diff, extra, now),
    )
    get_conn().commit()
    return {"id": cur.lastrowid, "session_id": session_id, "role": role,
            "type": msg_type, "content": content, "file_path": file_path,
            "diff": diff, "extra": extra, "created_at": now}


def get_messages(session_id: str, limit: int = 500) -> list:
    rows = get_conn().execute(
        "SELECT id, session_id, role, type, content, file_path, diff, "
        "COALESCE(extra, '') AS extra, created_at "
        "FROM messages WHERE session_id=? ORDER BY created_at ASC LIMIT ?",
        (session_id, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def start_agent_run(session_id: str, prompt: str, engine: str,
                    agent: str, model: str = "") -> str:
    rid = uuid.uuid4().hex[:12]
    now = time.time()
    get_conn().execute(
        "INSERT INTO agent_runs (id, session_id, prompt, status, engine, agent, model, started_at) "
        "VALUES (?, ?, ?, 'running', ?, ?, ?, ?)",
        (rid, session_id, prompt, engine, agent, model, now),
    )
    get_conn().commit()
    return rid


def finish_agent_run(run_id: str, status: str = "completed") -> None:
    get_conn().execute(
        "UPDATE agent_runs SET status=?, completed_at=? WHERE id=?",
        (status, time.time(), run_id),
    )
    get_conn().commit()


def get_active_runs(session_id: str) -> list:
    rows = get_conn().execute(
        "SELECT * FROM agent_runs WHERE session_id=? AND status='running'",
        (session_id,),
    ).fetchall()
    return [dict(r) for r in rows]
