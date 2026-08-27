import asyncio
import json
import shlex
import shutil
import time

from config import settings


class AgentRunner:
    """Streams a real agent CLI (e.g. `opencode run`) over the websocket.

    Accepted CLI protocols:
      * NDJSON events (`--format json`): text/tool/reasoning parts are mapped.
      * Plain console output: forwarded line by line as stdout.
    Falls back to a simulated flow when AGENT_MODE=mock or the binary is missing.
    """

    def __init__(self, project_path: str):
        self.project_path = project_path
        self.task: asyncio.Task | None = None
        self._proc: asyncio.subprocess.Process | None = None

    @property
    def mode(self) -> str:
        if settings.AGENT_MODE == "mock" or settings.AGENT_MODE.lower().startswith("mock"):
            return "mock"
        cmd = settings.AGENT_COMMAND.strip()
        if not cmd:
            return "mock"
        prog = shlex.split(cmd)[0]
        if shutil.which(prog) is None:
            return "mock"
        return "cli"

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
        if self.mode == "mock":
            await self._run_mock(prompt, websocket)
        else:
            await self._run_cli(prompt, websocket)
        self.task = None

    # ------------------------------------------------------------------ CLI
    async def _run_cli(self, prompt: str, websocket) -> None:
        cmd = shlex.split(settings.AGENT_COMMAND) + [prompt]
        await websocket.send_json({"type": "thinking", "content": "Starting agent session..."})
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
        except Exception as exc:  # pragma: no cover
            await websocket.send_json({"type": "error", "content": str(exc)})
        finally:
            elapsed = max(0, int(time.monotonic() - started))
            response = "".join(final_text).strip() or f"Agent session finished (exit code {code})."
            await websocket.send_json({"type": "done", "response": response, "elapsed": elapsed})

    async def _drain(self, stream, websocket, final_text: list[str]) -> None:
        """Read a byte stream line by line, forwarding structured events or raw text."""
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

    # ------------------------------------------------------------------ MOCK
    async def _run_mock(self, prompt: str, websocket) -> None:
        await websocket.send_json(
            {"type": "thinking", "content": f"Analyzing prompt: '{prompt}' for project at {self.project_path}..."}
        )
        await asyncio.sleep(1.5)
        await websocket.send_json({"type": "thinking", "content": "Planning modifications..."})
        await asyncio.sleep(1)
        diff_str = (
            "--- a/src/App.jsx\n+++ b/src/App.jsx\n@@ -1,5 +1,6 @@\n"
            " import React from 'react';\n+import { NewFeature } from './components';\n \n"
            " function App() {\n-  return <div>Hello</div>;\n+  return <div><NewFeature /></div>;\n }"
        )
        await websocket.send_json({"type": "file_mod", "file": "src/App.jsx", "diff": diff_str})
        await asyncio.sleep(1)
        await websocket.send_json({"type": "stdout", "content": "Build successful.\n"})
        await asyncio.sleep(0.5)
        await websocket.send_json(
            {
                "type": "done",
                "response": f"I have processed your request for '{prompt}'. The changes have been applied.",
            }
        )