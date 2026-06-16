"""Application configuration loaded from environment variables.

Uses ``pydantic-settings`` so every value can be overridden via env vars
without touching source code.  No secrets are hardcoded.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central configuration for the F1 Telemetry Platform backend."""

    # -- Server --
    app_title: str = "F1 Telemetry Platform"
    app_version: str = "0.1.0"
    log_level: str = "INFO"

    # -- CORS --
    # TODO(security): For production, restrict to the exact frontend origin.
    allowed_origins: list[str] = ["http://localhost:3000"]

    # -- Ingestion --
    ingestion_interval_seconds: int = 300
    fastf1_cache_dir: str = ".fastf1_cache"

    # -- Feature flags --
    enable_scheduled_ingestion: bool = False

    model_config = {"env_prefix": "F1_", "case_sensitive": False}


# Singleton — importable everywhere
settings = Settings()
