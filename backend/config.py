import sys
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent

_dotenv_candidates = [
    str(_backend_dir / ".env"),
    str(Path.cwd() / ".env"),
]
if getattr(sys, "frozen", False):
    _dotenv_candidates.append(str(Path(sys.executable).resolve().parent / ".env"))

for _p in dict.fromkeys(_dotenv_candidates):
    if Path(_p).exists():
        load_dotenv(_p, override=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file_encoding="utf-8", extra="ignore")

    WORKSPACE_DIR: str = "~/dev-projects"
    AUTH_PIN: str = "1234"
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Where the built SPA lives. Empty = auto-detect (frontend/dist or bundled "web").
    FRONTEND_DIST_DIR: str = ""

    # Agent configuration. "cli" runs settings.AGENT_COMMAND as a subprocess.
    # "mock" replays the simulated flow. Falls back to "mock" if the binary is missing.
    AGENT_MODE: str = "cli"
    AGENT_COMMAND: str = "opencode run --format json --dangerously-skip-permissions"
    AGENT_CLI_TIMEOUT: int = 900

    # Cloudflare quick tunnel. Empty CLOUDFLARED_PATH = auto-detect.
    CLOUDFLARED_PATH: str = ""
    TUNNEL_ENABLED: bool = True

    # Auth session lifetime.
    SESSION_TTL_HOURS: int = 24


settings = Settings()


def get_workspace_path() -> Path:
    """Returns the resolved workspace path."""
    return Path(settings.WORKSPACE_DIR).expanduser().resolve()