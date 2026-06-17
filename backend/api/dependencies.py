"""FastAPI dependency injection factories.

Provides singleton instances of core services via ``app.state`` so they
are initialised once at startup and shared across all request handlers.
"""

from __future__ import annotations

from fastapi import Request, WebSocket

from backend.ingestion.fastf1_client import FastF1Client
from backend.services.telemetry_store import TelemetryStore
from backend.services.ws_manager import ConnectionManager


def get_telemetry_store(request: Request) -> TelemetryStore:
    """Retrieve the ``TelemetryStore`` singleton from app state."""
    return request.app.state.telemetry_store


def get_ws_manager(websocket: WebSocket) -> ConnectionManager:
    """Retrieve the ``ConnectionManager`` singleton from app state."""
    return websocket.app.state.ws_manager


def get_fastf1_client(request: Request) -> FastF1Client:
    """Retrieve the ``FastF1Client`` singleton from app state."""
    return request.app.state.fastf1_client
