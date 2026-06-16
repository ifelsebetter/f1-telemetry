"""WebSocket endpoint for real-time telemetry streaming.

Clients connect to ``/ws/telemetry`` and optionally send a JSON message
with subscription filters immediately after the handshake.  The server
then pushes ``TelemetryStreamMessage`` objects as new data arrives.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from backend.api.dependencies import get_ws_manager
from backend.models.schemas import TelemetryStreamMessage, TelemetryData
from backend.services.ws_manager import ConnectionManager

logger = logging.getLogger(__name__)

ws_router = APIRouter(tags=["websocket"])




@ws_router.websocket("/ws/telemetry")
async def telemetry_stream(
    websocket: WebSocket,
    manager: ConnectionManager = Depends(get_ws_manager),
) -> None:
    """Handle a WebSocket connection for live telemetry updates.

    Protocol
    --------
    1. Client connects → server accepts.
    2. Client *may* send a JSON object with subscription filters::

           {"lap": 5, "fields": ["speed", "throttle"]}

    3. Server pushes ``TelemetryStreamMessage`` JSON whenever new data
       matching the filters arrives (via ``ConnectionManager.broadcast``).
    4. Client can send ``{"type": "ping"}`` to keep the connection alive;
       the server responds with ``{"type": "pong"}``.
    5. Connection closes on disconnect or error.
    """
    filters: dict[str, Any] = {}
    await manager.connect(websocket, filters)

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                msg = json.loads(raw_text)
                if isinstance(msg, dict):
                    if msg.get("type") == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))
                        continue

                    # Process as a filter update
                    allowed_keys = {"lap", "fields", "session_type", "year", "round"}
                    parsed = {k: v for k, v in msg.items() if k in allowed_keys}
                    manager._active[websocket] = parsed
                    logger.info("Updated filters for WebSocket: %s", parsed)
                    await websocket.send_text(
                        json.dumps({"type": "filters_updated", "filters": parsed})
                    )
            except (json.JSONDecodeError, TypeError):
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("WebSocket client disconnected normally")
    except Exception:
        manager.disconnect(websocket)
        logger.exception("WebSocket error — connection closed")
