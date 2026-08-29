import asyncio
import logging
from typing import Optional

from services import session_store
from services.agent_runner import AgentRunner

logger = logging.getLogger(__name__)


class SessionRun:
    """Daemon-side run for one session. Survives any single client disconnect:
    clients subscribe/unsubscribe while the run task keeps going and events are
    persisted to the DB, so reconnect replays everything.
    """

    def __init__(self, session_id: str, project_path: str,
                 engine: str = "antigravity", agent: str = "code-fixer",
                 model: str = "", oc_session_id: str = ""):
        self.session_id = session_id
        self.project_path = project_path
        self.runner = AgentRunner(
            project_path, engine=engine, agent=agent, model=model,
            oc_session_id=oc_session_id,
        )
        self.run_id: Optional[str] = None
        self.task: Optional[asyncio.Task] = None
        self.subscribers: set = set()
        self.pending_attachments: list[dict] = []

    def is_running(self) -> bool:
        return self.task is not None and not self.task.done()

    def subscribe(self, ws) -> None:
        self.subscribers.add(ws)

    def unsubscribe(self, ws) -> None:
        self.subscribers.discard(ws)

    async def send_json(self, data: dict) -> None:
        """Persist the event once, then fan out to every connected client."""
        try:
            _persist_event(self.session_id, data)
        except Exception:
            pass
        dead = []
        for ws in list(self.subscribers):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.subscribers.discard(ws)

    def cancel(self) -> None:
        self.runner.cancel()
        if self.task is not None and not self.task.done():
            self.task.cancel()


_runs: dict[str, SessionRun] = {}


def get_run(session_id: str) -> Optional[SessionRun]:
    return _runs.get(session_id)


def create_run(session_id: str, project_path: str, engine: str,
               agent: str, model: str, oc_session_id: str = "") -> SessionRun:
    run = SessionRun(session_id, project_path, engine, agent, model, oc_session_id)
    _runs[session_id] = run
    return run


def start_run(session_id: str, project_path: str, prompt: str,
              engine: str, agent: str, model: str,
              oc_session_id: str = "", history_ctx: str = "") -> SessionRun:
    """Start a daemon-side agent run for a session. Returns (run, started).
    If a run is already active for the session, returns without starting.
    """
    run = _runs.get(session_id)
    if run is None:
        run = create_run(session_id, project_path, engine, agent, model, oc_session_id)
    if run.is_running():
        return run

    run.runner.engine = engine
    run.runner.agent = agent
    run.runner.model = model
    run.runner.oc_session_id = oc_session_id
    run.runner.history_ctx = history_ctx
    run.pending_attachments = []
    run.run_id = session_store.start_agent_run(session_id, prompt, engine, agent, model)

    task = asyncio.create_task(run.runner.run_prompt(prompt, run))

    def _done(fut: asyncio.Task):
        try:
            fut.result()
            session_store.finish_agent_run(run.run_id, "completed")
        except asyncio.CancelledError:
            session_store.finish_agent_run(run.run_id, "cancelled")
        except Exception:
            session_store.finish_agent_run(run.run_id, "failed")
        # Capture the opencode session id so later turns continue the same
        # session (context kept in the system's opencode database).
        if run.runner.last_session_id:
            try:
                session_store.update_session(session_id, oc_session_id=run.runner.last_session_id)
            except Exception:
                pass

    task.add_done_callback(_done)
    run.task = task
    return run


def _persist_event(session_id: str, data: dict) -> None:
    etype = data.get("type", "")
    try:
        if etype in ("thinking", "stdout", "stderr", "text"):
            session_store.add_message(
                session_id, "agent", "thinking" if etype == "thinking" else "terminal",
                content=data.get("content", ""),
            )
        elif etype == "file_mod":
            session_store.add_message(
                session_id, "agent", "diff",
                file_path=data.get("file", ""), diff=data.get("diff", ""),
            )
        elif etype == "done":
            session_store.add_message(
                session_id, "agent", "text", content=data.get("response", ""),
            )
        elif etype == "error":
            session_store.add_message(
                session_id, "system", "error", content=data.get("content", ""),
            )
    except Exception:
        logger.exception("persist event failed for session %s", session_id)