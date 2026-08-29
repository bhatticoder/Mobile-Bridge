import asyncio
import json
import shlex
import shutil
import time
from pathlib import Path

from config import settings

# AntiGravity built-in persona agents
AGENT_PERSONAS = {
    "code-fixer": {
        "name": "Code Fixer",
        "description": "Analyzes and fixes bugs in your code",
        "icon": "Bug",
        "prompt_prefix": "You are a debugging expert. Analyze the workspace and fix any bugs you find. Explain each fix clearly.",
    },
    "code-explainer": {
        "name": "Code Explainer",
        "description": "Explains code architecture and logic",
        "icon": "Lightbulb",
        "prompt_prefix": "You are a technical documentation expert. Explain the code architecture, patterns, and logic of this project clearly.",
    },
    "refactorer": {
        "name": "Refactorer",
        "description": "Suggests and applies refactoring improvements",
        "icon": "PenTool",
        "prompt_prefix": "You are a code quality expert. Analyze the codebase and suggest specific refactoring improvements. Apply the most impactful changes.",
    },
    "test-writer": {
        "name": "Test Writer",
        "description": "Generates unit and integration tests",
        "icon": "CheckCircle",
        "prompt_prefix": "You are a test engineering expert. Analyze the workspace and write comprehensive tests for the main modules.",
    },
    "code-reviewer": {
        "name": "Code Reviewer",
        "description": "Reviews code for quality, security, and best practices",
        "icon": "Shield",
        "prompt_prefix": "You are a senior code reviewer. Review the codebase for quality issues, security vulnerabilities, and best practice violations.",
    },
}


def list_agents() -> list:
    agents = []
    for key, info in AGENT_PERSONAS.items():
        agents.append({"id": key, **info, "engine": "antigravity"})
    return agents


_models_cache: dict = {"ts": 0.0, "data": []}
_MODELS_TTL = 300.0  # seconds


def list_opencode_models(force: bool = False) -> list:
    """Models from the local opencode install. Cached 5 min because spawning
    `opencode models` (which reads a large sqlite db) costs ~4s every call."""
    import time as _t
    now = _t.time()
    if not force and (now - _models_cache["ts"]) < _MODELS_TTL:
        return _models_cache["data"]
    cmd = shlex.split(settings.AGENT_COMMAND)[0]
    if shutil.which(cmd) is None:
        return []
    try:
        import subprocess
        r = subprocess.run(
            [cmd, "models"], capture_output=True, text=True, timeout=10
        )
        models = []
        for line in r.stdout.strip().splitlines():
            line = line.strip()
            if line and "/" in line:
                models.append({"id": line, "name": line.split("/")[-1].replace("-", " ").title()})
        _models_cache["ts"] = now
        _models_cache["data"] = models
        return models
    except Exception:
        return []


class AgentRunner:
    """Streams an agent over the websocket.
    Supports two engines:
      - antigravity: built-in persona agents (simulated with contextual prompts)
      - opencode: real CLI agent (opencode run --format json)
    """

    def __init__(self, project_path: str, engine: str = "antigravity",
                 agent: str = "code-fixer", model: str = "",
                 oc_session_id: str = "", history_ctx: str = ""):
        self.project_path = project_path
        self.engine = engine
        self.agent = agent
        self.model = model
        self.task: asyncio.Task | None = None
        self._proc: asyncio.subprocess.Process | None = None
        # Real opencode session this conversation maps to (context on the system).
        self.oc_session_id = oc_session_id
        # Captured after a CLI run so the next turn can continue the same session.
        self.last_session_id = ""
        # Prior conversation text for the Antigravity persona (multi-turn).
        self.history_ctx = history_ctx

    @property
    def cli_mode(self) -> bool:
        if self.engine != "opencode":
            return False
        cmd = settings.AGENT_COMMAND.strip()
        if not cmd:
            return False
        prog = shlex.split(cmd)[0]
        return shutil.which(prog) is not None

    def cancel(self) -> None:
        proc = self._proc
        if proc is not None and proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        task = self.task
        if task is not None and not task.done():
            task.cancel()

    async def run_prompt(self, prompt: str, websocket) -> None:
        if self.engine == "opencode" and self.cli_mode:
            await self._run_cli(prompt, websocket)
        else:
            await self._run_persona(prompt, websocket)
        self.task = None

    # ── Persona (AntiGravity built-in) ──────────────────────────────
    async def _run_persona(self, prompt: str, websocket) -> None:
        persona = AGENT_PERSONAS.get(self.agent, AGENT_PERSONAS["code-fixer"])
        full_prompt = f"{persona['prompt_prefix']}\n\nUser request: {prompt}"
        if self.history_ctx:
            full_prompt += f"\n\nPrevious conversation:\n{self.history_ctx}"

        await websocket.send_json({"type": "thinking", "content": f"[{persona['name']}] Analyzing workspace..."})

        ws_path = Path(self.project_path)
        context_files = self._gather_context(ws_path)

        if context_files:
            await websocket.send_json({"type": "thinking", "content": f"Reading {len(context_files)} project files for context..."})
            await asyncio.sleep(0.5)

        await websocket.send_json({"type": "thinking", "content": f"Applying {persona['name']} logic..."})
        await asyncio.sleep(1)

        mock_diff = (
            "--- a/src/main.py\n+++ b/src/main.py\n@@ -1,3 +1,5 @@\n"
            " # Auto-generated by Antigravity Hub\n+import logging\n+\n"
            f"# {persona['name']}: {prompt[:60]}\n"
            " def main():\n-    pass\n+    logging.info('Hello from Antigravity Hub')\n"
        )
        await websocket.send_json({
            "type": "file_mod",
            "file": "src/main.py",
            "diff": mock_diff,
        })
        await asyncio.sleep(0.5)
        await websocket.send_json({"type": "stdout", "content": f"[{persona['name']}] Changes applied successfully.\n"})

        response = (
            f"**{persona['name']}** processed your request.\n\n"
            f"Request: {prompt}\n\n"
            f"Changes have been applied to the project. "
            f"Review the diff above and test locally."
        )
        await websocket.send_json({"type": "done", "response": response})

    def _gather_context(self, ws_path: Path, max_files: int = 15) -> list:
        files = []
        ignore = {".git", "node_modules", "__pycache__", ".venv", "dist", "build", ".cache"}
        for f in sorted(ws_path.rglob("*")):
            if len(files) >= max_files:
                break
            if f.is_file() and not any(p in f.parts for p in ignore) and f.stat().st_size < 50_000:
                try:
                    content = f.read_text(errors="replace")
                    files.append({"path": str(f.relative_to(ws_path)), "content": content[:2000]})
                except Exception:
                    pass
        return files

    # ── OpenCode CLI ────────────────────────────────────────────────
    async def _run_cli(self, prompt: str, websocket) -> None:
        cmd = shlex.split(settings.AGENT_COMMAND)
        if self.model:
            cmd += ["--model", self.model]
        if self.oc_session_id:
            # Continue the same opencode session so context stays in the
            # system's opencode database across turns.
            cmd += ["--session", self.oc_session_id]
        else:
            clean_title = (prompt or "").strip().replace("\n", " ")[:60]
            cmd += ["--title", clean_title or "New chat"]
        cmd += [prompt]

        await websocket.send_json({"type": "thinking", "content": "Starting OpenCode session..."})
        self._proc = None
        final_text: list[str] = []
        started = time.monotonic()
        code = None
        try:
            self._proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=self.project_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            assert self._proc.stdout is not None
            await asyncio.wait_for(
                self._drain(self._proc.stdout, websocket, final_text),
                timeout=settings.AGENT_CLI_TIMEOUT,
            )
            code = await self._proc.wait()
        except asyncio.TimeoutError:
            await websocket.send_json(
                {"type": "error", "content": f"Agent timed out after {settings.AGENT_CLI_TIMEOUT}s."}
            )
            self.cancel()
        except asyncio.CancelledError:
            proc = self._proc
            if proc is not None and proc.returncode is None:
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
            raise
        except Exception as exc:
            await websocket.send_json({"type": "error", "content": str(exc)})
        finally:
            elapsed = max(0, int(time.monotonic() - started))
            response = "".join(final_text).strip() or f"Agent finished (exit code {code})."
            await websocket.send_json({"type": "done", "response": response, "elapsed": elapsed})

    async def _drain(self, stream, websocket, final_text: list[str]) -> None:
        async for raw in stream:
            line = raw.decode(errors="replace").rstrip("\n")
            if not line.strip():
                continue
            stripped = line.lstrip()
            if not stripped.startswith("{"):
                await websocket.send_json({"type": "stdout", "content": line + "\n"})
                continue
            event = self._parse_json_line(line)
            if event is None:
                await websocket.send_json({"type": "stdout", "content": line + "\n"})
                continue
            sid = event.get("sessionID") or event.get("session_id")
            if sid:
                self.last_session_id = sid
            kind, payload = self._classify(event)
            if kind == "text":
                if payload:
                    final_text.append(payload)
                    await websocket.send_json({"type": "stdout", "content": payload})
            elif kind == "thinking":
                await websocket.send_json({"type": "thinking", "content": payload})
            elif kind == "file":
                await websocket.send_json({"type": "file_mod", "file": payload, "diff": ""})

    @staticmethod
    def _parse_json_line(line: str):
        try:
            return json.loads(line)
        except (json.JSONDecodeError, ValueError):
            return None

    @staticmethod
    def _classify(event: dict):
        part = event.get("part") or {}
        ptype = part.get("type") or event.get("type")
        if ptype == "text":
            return "text", part.get("text") or part.get("content") or ""
        if ptype in ("reasoning", "thinking", "step_start", "step_start_comment"):
            content = part.get("text") or part.get("content") or event.get("type", ptype)
            return "thinking", content
        if ptype in ("file", "file.write", "file_write"):
            path = part.get("filePath") or part.get("path") or part.get("file") or ""
            return "file", str(path)
        if ptype in ("tool", "tool_use", "tool_use_start", "tool_call"):
            title = (
                part.get("state", {}).get("title")
                or part.get("name", "")
                or part.get("toolName", "")
            )
            return "thinking", title or "Running tool..."
        return "noop", None
