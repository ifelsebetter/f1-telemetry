"""Application configuration loaded from environment variables.

Uses ``pydantic-settings`` so every value can be overridden via env vars
without touching source code.  No secrets are hardcoded.
"""

from __future__ import annotations

from pathlib import Path
from pydantic_settings import BaseSettings

_DEFAULT_CACHE_DIR = str(Path(__file__).resolve().parent.parent / ".fastf1_cache")


class Settings(BaseSettings):
    """Central configuration for the F1 Telemetry Platform backend."""

    # -- Server --
    app_title: str = "F1 Telemetry Platform"
    app_version: str = "0.1.0"
    log_level: str = "INFO"

    # -- CORS --
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

    # -- Ingestion --
    ingestion_interval_seconds: int = 300
    fastf1_cache_dir: str = _DEFAULT_CACHE_DIR

    # -- Feature flags --
    enable_scheduled_ingestion: bool = False

    model_config = {"env_prefix": "F1_", "case_sensitive": False}


# Singleton — importable everywhere
settings = Settings()
