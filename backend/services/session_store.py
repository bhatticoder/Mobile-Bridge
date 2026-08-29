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


def set_oc_session(session_id: str, oc_session_id: str) -> None:
    get_conn().execute(
        "UPDATE sessions SET oc_session_id=?, updated_at=? WHERE id=?",
        (oc_session_id, time.time(), session_id),
    )
    get_conn().commit()


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


def list_conversations(project: str | None = None, limit: int = 50) -> list:
    """Conversations like a chat history panel: title, time, engine/agent,
    and a preview of the last user/agent text plus whether a run is active.
    Only returns sessions that actually contain messages (a real chat)."""
    cur = get_conn().execute(
        "SELECT s.*, "
        "r.status AS run_status, r.started_at AS run_started_at, "
        "r.prompt AS run_prompt "
        "FROM sessions s "
        "LEFT JOIN agent_runs r ON r.session_id = s.id "
        "  AND r.id = (SELECT r2.id FROM agent_runs r2 "
        "              WHERE r2.session_id = s.id "
        "              ORDER BY r2.started_at DESC LIMIT 1) "
        "WHERE (? IS NULL OR s.project = ?) "
        "AND EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id) "
        "ORDER BY s.updated_at DESC LIMIT ?",
        (project if project else None, project if project else None, limit),
    )
    rows = cur.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["running"] = d.get("run_status") == "running"
        d.pop("run_status", None)
        last = get_conn().execute(
            "SELECT role, type, content, file_path FROM messages "
            "WHERE session_id=? AND type IN ('text','terminal','error') "
            "ORDER BY created_at DESC, id DESC LIMIT 1",
            (d["id"],),
        ).fetchone()
        d["last_message"] = last["content"][:120] if last else ""
        d["last_role"] = last["role"] if last else ""
        result.append(d)
    return result


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


def get_last_run(session_id: str) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM agent_runs WHERE session_id=? "
        "ORDER BY started_at DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    return dict(row) if row else None


def ensure_title(session_id: str, prompt: str) -> None:
    """Set a session title from the first user prompt if none exists yet."""
    row = get_conn().execute(
        "SELECT title FROM sessions WHERE id=?", (session_id,)
    ).fetchone()
    if row is None:
        return
    if row["title"].strip():
        return
    title = (prompt or "New chat").strip().replace("\n", " ")
    if len(title) > 60:
        title = title[:57] + "..."
    get_conn().execute(
        "UPDATE sessions SET title=?, updated_at=? WHERE id=?",
        (title, time.time(), session_id),
    )
    get_conn().commit()


def get_conversation_context(session_id: str, max_msgs: int = 8) -> str:
    """Recent user+agent text for multi-turn persona/CLI context."""
    rows = get_conn().execute(
        "SELECT role, type, content FROM messages "
        "WHERE session_id=? AND type IN ('text','terminal') "
        "ORDER BY created_at ASC, id ASC LIMIT ?",
        (session_id, max_msgs * 2),
    ).fetchall()
    lines = []
    for r in list(rows)[-max_msgs:]:
        who = "User" if r["role"] == "user" else "Assistant"
        text = (r["content"] or "").strip()
        if text:
            lines.append(f"{who}: {text[:300]}")
    return "\n".join(lines)
