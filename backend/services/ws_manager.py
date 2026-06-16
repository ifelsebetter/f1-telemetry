"""WebSocket connection manager.

Tracks active WebSocket connections and broadcasts ``TelemetryStreamMessage``
objects to all subscribers.  Each connection can optionally register a filter
so it only receives messages for specific sessions, laps, or fields.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

from backend.models.schemas import TelemetryStreamMessage

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket lifecycle and message broadcasting."""

    def __init__(self) -> None:
        self._active: dict[WebSocket, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(
        self,
        websocket: WebSocket,
        filters: dict[str, Any] | None = None,
    ) -> None:
        """Accept a WebSocket and register it with optional filters."""
        await websocket.accept()
        self._active[websocket] = filters or {}
        logger.info(
            "WebSocket connected (total=%d, filters=%s)",
            len(self._active),
            filters,
        )

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket from the active set."""
        self._active.pop(websocket, None)
        logger.info(
            "WebSocket disconnected (total=%d)",
            len(self._active),
        )

    # ------------------------------------------------------------------
    # Broadcasting
    # ------------------------------------------------------------------

    async def broadcast(self, message: TelemetryStreamMessage) -> None:
        """Send *message* to every connected client whose filters match."""
        payload_json = message.model_dump_json()

        stale: list[WebSocket] = []
        for ws, filters in self._active.items():
            if not self._matches_filters(message, filters):
                continue
            try:
                await ws.send_text(payload_json)
            except Exception:
                logger.warning("Failed to send to WebSocket — marking stale")
                stale.append(ws)

        for ws in stale:
            self.disconnect(ws)

    async def send_personal(
        self,
        websocket: WebSocket,
        message: TelemetryStreamMessage,
    ) -> None:
        """Send a message to a single client."""
        try:
            await websocket.send_text(message.model_dump_json())
        except Exception:
            logger.warning("Failed personal send — disconnecting")
            self.disconnect(websocket)

    # ------------------------------------------------------------------
    # Filter logic
    # ------------------------------------------------------------------

    @staticmethod
    def _matches_filters(
        message: TelemetryStreamMessage,
        filters: dict[str, Any],
    ) -> bool:
        """Return ``True`` if *message* satisfies the client's filters.

        Supported filter keys (all optional):
        - ``lap``: int — only receive data for this lap
        - ``fields``: list[str] — ignored at broadcast level (field
          projection is a presentation concern handled by the client)
        """
        if not filters:
            return True

        lap_filter = filters.get("lap")
        if lap_filter is not None and message.payload.lap != lap_filter:
            return False

        return True

    @property
    def active_count(self) -> int:
        """Number of currently connected clients."""
        return len(self._active)
