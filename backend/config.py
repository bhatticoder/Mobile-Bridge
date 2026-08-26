import os
from pathlib import Path
from pydantic import BaseSettings

class Settings(BaseSettings):
    WORKSPACE_DIR: str = "~/dev-projects"
    AUTH_PIN: str = "1234"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    class Config:
        env_file = ".env"
        env_file_encoding = 'utf-8'

settings = Settings()

def get_workspace_path() -> Path:
    """Returns the resolved workspace path."""
    return Path(settings.WORKSPACE_DIR).expanduser().resolve()
