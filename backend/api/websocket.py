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
    year: int = 2023,
    round: int = 1,
    session_type: str = "Q",
    driver: str = "VER",
    circuit_id: str = "bahrain",
    manager: ConnectionManager = Depends(get_ws_manager),
    client: FastF1Client = Depends(get_fastf1_client),
) -> None:
    """Handle a WebSocket connection for 20 Hz live and replay telemetry."""
    filters: dict[str, Any] = {}
    await manager.connect(websocket, filters)

    replay = ReplayEngine(
        client=client,
        year=year,
        round_number=round,
        session_type=session_type,
        circuit_id=circuit_id,
        tick_rate_hz=20,
        defer_load=True,
    )
    replay.set_primary_driver(driver)
    await replay.async_load_session_data()
    if websocket in manager._active:
        await websocket.send_text(json.dumps({
            "type": "session_metadata",
            "year": replay.year,
            "round": replay.round_number,
            "session_type": replay.session_type,
            "circuit_id": replay.circuit_id,
            "driver_results": replay.driver_results,
            "total_laps": replay.total_laps,
            "lap_duration": replay.lap_duration,
            "total_race_duration": replay.total_race_duration,
        }))

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
                    snap = replay.get_current_frame_message()
                    if snap is not None:
                        await websocket.send_text(snap.model_dump_json())
                elif msg_type == "seek_index":
                    idx = int(msg.get("index", 0))
                    replay.seek_to_index(idx)
                    snap = replay.get_current_frame_message()
                    if snap is not None:
                        await websocket.send_text(snap.model_dump_json())
                elif msg_type == "seek_lap":
                    lap_num = int(msg.get("lap", 1))
                    replay.seek_to_lap(lap_num)
                    snap = replay.get_current_frame_message()
                    if snap is not None:
                        await websocket.send_text(snap.model_dump_json())
                elif msg_type == "set_speed":
                    spd = float(msg.get("speed", 1.0))
                    replay.set_speed(spd)
                    await websocket.send_text(json.dumps({"type": "speed_status", "speed": replay.speed}))
                elif msg_type == "set_circuit":
                    c_id = str(msg.get("circuit_id", "bahrain"))
                    replay.set_circuit(c_id)
                    await websocket.send_text(json.dumps({"type": "circuit_switched", "circuit_id": replay.circuit_id}))
                elif msg_type == "set_driver":
                    drv = str(msg.get("driver", "VER"))
                    replay.set_primary_driver(drv)
                    await websocket.send_text(json.dumps({"type": "driver_switched", "driver": replay.primary_driver}))
                elif msg_type == "switch_race":
                    s_year = int(msg.get("year", 2023))
                    round_num = int(msg.get("round", 1))
                    s_type = str(msg.get("session_type", "Q"))
                    c_id = str(msg.get("circuit_id", "bahrain"))
                    await websocket.send_text(json.dumps({"type": "loading_status", "loading": True}))
                    await replay.async_switch_race(s_year, round_num, s_type, c_id)
                    await websocket.send_text(json.dumps({
                        "type": "race_switched",
                        "year": replay.year,
                        "round": replay.round_number,
                        "session_type": replay.session_type,
                        "circuit_id": replay.circuit_id,
                        "driver_results": replay.driver_results,
                        "total_laps": replay.total_laps,
                        "lap_duration": replay.lap_duration,
                        "total_race_duration": replay.total_race_duration,
                        "loading": False,
                    }))
                    snap = replay.get_current_frame_message()
                    if snap is not None:
                        await websocket.send_text(snap.model_dump_json())
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
        logger.info("WebSocket client disconnected normally")
    except Exception:
        logger.exception("WebSocket error — connection closed")
    finally:
        stream_task.cancel()
        try:
            await stream_task
        except asyncio.CancelledError:
            pass
        manager.disconnect(websocket)
