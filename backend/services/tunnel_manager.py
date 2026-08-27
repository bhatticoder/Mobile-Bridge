import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Optional

import psutil

from config import settings

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
MAX_RESTARTS = 12
RESTART_DELAY = 5


def default_cloudflared_path() -> str:
    # Packaged (PyInstaller): bundled into _MEIPASS/bin or next to the executable.
    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        for cand in (meipass / "bin" / "cloudflared", Path(sys.executable).parent / "cloudflared"):
            if cand.exists():
                return str(cand)
    here = Path(__file__).resolve()
    for cand in (
        here.parent.parent / "bin" / "cloudflared",  # backend/bin/cloudflared
        Path("/usr/local/bin") / "cloudflared",
        Path("/usr/bin") / "cloudflared",
    ):
        if cand.exists():
            return str(cand)
    found = shutil.which("cloudflared")
    return found or ""


class TunnelManager:
    def __init__(self):
        self._proc: Optional[subprocess.Popen] = None
        self._url: Optional[str] = None
        self._stopping = False
        self._restarts = 0
        # RLock so start() may safely re-enter status() on the same thread.
        self._lock = threading.RLock()
        self._log: list[str] = []

    def binary_path(self) -> str:
        return settings.CLOUDFLARED_PATH or default_cloudflared_path()

    def is_installed(self) -> bool:
        return bool(self.binary_path())

    def status(self) -> dict:
        with self._lock:
            if not self.binary_path():
                return {
                    "status": "error",
                    "url": None,
                    "message": "cloudflared binary not found. Put it in backend/bin/ or set CLOUDFLARED_PATH.",
                }
            if self._proc is None:
                return {"status": "stopped", "url": None, "restarts": self._restarts}
            if self._proc.poll() is not None:
                return {"status": "stopped", "url": None, "exit_code": self._proc.poll(), "restarts": self._restarts}
            if self._url:
                return {"status": "active", "url": self._url, "restarts": self._restarts}
            return {"status": "connecting", "url": None, "restarts": self._restarts}

    def logs(self, count: int = 60) -> list:
        with self._lock:
            return list(self._log[-count:])

    def start(self) -> dict:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return self.status()
            self._stopping = False
            self._start_locked()
            return self.status()

    def _start_locked(self) -> None:
        exe = self.binary_path()
        if not exe:
            return
        self._url = None
        self._read_error = False
        proc = subprocess.Popen(
            [exe, "tunnel", "--url", f"http://127.0.0.1:{settings.PORT}", "--no-autoupdate"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self._proc = proc
        threading.Thread(target=self._run, args=(proc,), daemon=True).start()

    def stop(self) -> dict:
        with self._lock:
            self._stopping = True
            proc = self._proc
            self._proc = None
        if proc is not None and proc.poll() is None:
            try:
                parent = psutil.Process(proc.pid)
                for child in parent.children(recursive=True):
                    try:
                        child.terminate()
                    except psutil.NoSuchProcess:
                        pass
                parent.terminate()
                proc.wait(timeout=3)
            except (psutil.NoSuchProcess, subprocess.TimeoutExpired):
                try:
                    proc.kill()
                except Exception:
                    pass
        return {"status": "stopped", "url": None, "restarts": self._restarts}

    def _run(self, proc: subprocess.Popen) -> None:
        """Consume cloudflared output; auto-restart if it dies before a URL was reached."""
        if proc.stdout is None:
            return
        try:
            for line in iter(proc.stdout.readline, ""):
                line = line.rstrip("\n")
                if not line:
                    continue
                with self._lock:
                    self._log.append(line)
                m = URL_RE.search(line)
                if m:
                    with self._lock:
                        self._url = m.group(0)
                        self._restarts = 0  # healthy again
        finally:
            with self._lock:
                self._log.append("[tunnel process exited]")
        proc.stdout.close()

        with self._lock:
            if self._stopping:
                return
            if proc is not self._proc:
                return  # already replaced
            self._proc = None
            if self._restarts >= MAX_RESTARTS:
                self._log.append(f"[tunnel giving up after {self._restarts} restarts]")
                return
            self._restarts += 1
            wait = RESTART_DELAY
        self._log.append(f"[tunnel auto-restart in {wait}s (attempt {self._restarts})]")
        threading.Event().wait(wait)
        with self._lock:
            if self._stopping or self._proc is not None:
                return
            self._start_locked()


tunnel_manager = TunnelManager()