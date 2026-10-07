"""WebSocket endpoint for real-time multi-driver telemetry streaming and replay.

Clients connect to ``/ws/telemetry``. The server pushes 60 Hz multi-driver
synchronized telemetry updates sourced strictly from FastF1.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from backend.api.dependencies import get_fastf1_client, get_ws_manager
from backend.ingestion.fastf1_client import FastF1Client
from backend.services.replay import ReplayEngine
from backend.services.ws_manager import ConnectionManager

logger = logging.getLogger(__name__)

ws_router = APIRouter(tags=["websocket"])


@ws_router.websocket("/ws/telemetry")
async def telemetry_stream(
    websocket: WebSocket,
    manager: ConnectionManager = Depends(get_ws_manager),
    client: FastF1Client = Depends(get_fastf1_client),
) -> None:
    """Handle a WebSocket connection for 60 Hz live and replay telemetry."""
    filters: dict[str, Any] = {}
    await manager.connect(websocket, filters)

    replay = ReplayEngine(
        client=client,
        year=2023,
        round_number=12,
        session_type="R",
        circuit_id="spa",
        tick_rate_hz=20,
    )

    async def push_stream() -> None:
        try:
            async for msg in replay.stream():
                if websocket in manager._active:
                    await websocket.send_text(msg.model_dump_json())
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug("Replay stream push ended: %s", e)

    stream_task = asyncio.create_task(push_stream())

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                msg = json.loads(raw_text)
                if not isinstance(msg, dict):
                    continue

                msg_type = msg.get("type")
                if msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
                elif msg_type == "play":
                    replay.play()
                    await websocket.send_text(json.dumps({"type": "playback_status", "isPlaying": True}))
                elif msg_type == "pause":
                    replay.pause()
                    await websocket.send_text(json.dumps({"type": "playback_status", "isPlaying": False}))
                elif msg_type == "seek":
                    ts = float(msg.get("timestamp", 0.0))
                    replay.seek_to_time(ts)
                elif msg_type == "seek_index":
                    idx = int(msg.get("index", 0))
                    replay.seek_to_index(idx)
                elif msg_type == "set_speed":
                    spd = float(msg.get("speed", 1.0))
                    replay.set_speed(spd)
                    await websocket.send_text(json.dumps({"type": "speed_status", "speed": replay.speed}))
                elif msg_type == "set_circuit":
                    circuit_id = str(msg.get("circuit_id", "bahrain"))
                    replay.set_circuit(circuit_id)
                    await websocket.send_text(json.dumps({"type": "circuit_switched", "circuit_id": replay.circuit_id}))
                elif msg_type == "set_driver":
                    driver = str(msg.get("driver", "VER"))
                    replay.set_primary_driver(driver)
                    await websocket.send_text(json.dumps({"type": "driver_switched", "driver": replay.primary_driver}))
                elif msg_type == "switch_race":
                    year = int(msg.get("year", 2023))
                    round_num = int(msg.get("round", 1))
                    s_type = str(msg.get("session_type", "Q"))
                    circuit_id = str(msg.get("circuit_id", "bahrain"))
                    replay.switch_race(year, round_num, s_type, circuit_id)
                    await websocket.send_text(json.dumps({
                        "type": "race_switched",
                        "year": year,
                        "round": round_num,
                        "session_type": s_type,
                        "circuit_id": circuit_id,
                    }))
                else:
                    # Filter updates
                    allowed_keys = {"lap", "fields", "session_type", "year", "round", "driver", "circuit_id"}
                    parsed = {k: v for k, v in msg.items() if k in allowed_keys}
                    manager._active[websocket] = parsed
                    if "circuit_id" in parsed:
                        replay.set_circuit(str(parsed["circuit_id"]))
                    if "driver" in parsed:
                        replay.set_primary_driver(str(parsed["driver"]))
                    await websocket.send_text(
                        json.dumps({"type": "filters_updated", "filters": parsed})
                    )
            except (json.JSONDecodeError, TypeError, ValueError) as err:
                logger.debug("WebSocket incoming parse error: %s", err)
    except WebSocketDisconnect:
        stream_task.cancel()
        manager.disconnect(websocket)
        logger.info("WebSocket client disconnected normally")
    except Exception:
        stream_task.cancel()
        manager.disconnect(websocket)
        logger.exception("WebSocket error — connection closed")
