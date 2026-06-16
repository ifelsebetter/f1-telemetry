"""Raw telemetry processing pipeline.

Transforms the raw dicts produced by the ingestion layer into validated
``TelemetryData`` Pydantic models and persists them in the store.
Optionally broadcasts new data to WebSocket subscribers.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.models.schemas import TelemetryData, TelemetryStreamMessage
from backend.services.telemetry_store import TelemetryStore
from backend.services.ws_manager import ConnectionManager

logger = logging.getLogger(__name__)


def _safe_float(value: Any, default: float = 0.0) -> float:
    """Coerce *value* to float, returning *default* on failure."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result


def _safe_int(value: Any, default: int = 0) -> int:
    """Coerce *value* to int, returning *default* on failure."""
    try:
        result = int(value)
    except (TypeError, ValueError):
        return default
    return result


def _normalize_timestamp(raw: Any) -> float:
    """Convert a FastF1 ``Timedelta`` or numeric value to seconds."""
    if raw is None:
        raise ValueError("Timestamp cannot be None")
    if isinstance(raw, bool):
        raise ValueError("Timestamp cannot be boolean")
    if hasattr(raw, "total_seconds"):
        return float(raw.total_seconds())
    return float(raw)


def process_raw_batch(raw_records: list[dict[str, Any]]) -> list[TelemetryData]:
    """Validate and normalise a list of raw telemetry dicts.

    Invalid records are silently dropped and logged at ``WARNING`` level.
    """
    processed: list[TelemetryData] = []
    
    time_keys = {"Time", "timestamp"}
    telemetry_keys = {"Speed", "speed", "Throttle", "throttle", "Brake", "brake", "nGear", "gear", "RPM", "rpm"}

    for idx, raw in enumerate(raw_records):
        try:
            # Ensure it is a dict and has essential keys
            if not isinstance(raw, dict):
                logger.warning("Skipping invalid record at index %d: record is not a dict", idx)
                continue
                
            if not any(k in raw for k in time_keys) or not any(k in raw for k in telemetry_keys):
                logger.warning("Skipping invalid record at index %d: missing time or telemetry keys", idx)
                continue

            # Extract time field safely
            time_val = raw.get("Time")
            if time_val is None:
                time_val = raw.get("timestamp")

            # Extract lap field safely, defaulting to 1 on failure
            lap_val = raw.get("LapNumber")
            if lap_val is None:
                lap_val = raw.get("lap")
            lap = _safe_int(lap_val, default=1)

            record = TelemetryData(
                timestamp=_normalize_timestamp(time_val),
                lap=lap,
                speed=_safe_float(raw.get("Speed", raw.get("speed", 0))),
                throttle=_safe_float(raw.get("Throttle", raw.get("throttle", 0))),
                brake=_safe_float(raw.get("Brake", raw.get("brake", 0))),
                gear=_safe_int(raw.get("nGear", raw.get("gear", 0))),
                rpm=_safe_float(raw.get("RPM", raw.get("rpm", 0))),
            )
            processed.append(record)
        except Exception:
            logger.warning("Skipping invalid record at index %d due to validation failure", idx)

    logger.info(
        "Processed %d / %d raw records",
        len(processed),
        len(raw_records),
    )
    return processed


async def ingest_and_process(
    raw_records: list[dict[str, Any]],
    year: int,
    round_number: int,
    session_type: str,
    store: TelemetryStore,
    ws_manager: ConnectionManager | None = None,
    event_name: str = "",
) -> list[TelemetryData]:
    """End-to-end pipeline: validate → store → broadcast.

    Returns the list of processed ``TelemetryData`` records.
    """
    data = process_raw_batch(raw_records)
    if not data:
        logger.warning(
            "No valid records after processing for %s/%s/%s",
            year,
            round_number,
            session_type,
        )
        return data

    await store.store_telemetry(
        year=year,
        round_number=round_number,
        session_type=session_type,
        data=data,
        event_name=event_name,
    )

    # Broadcast latest samples to WebSocket subscribers
    if ws_manager is not None:
        for record in data[-10:]:
            message = TelemetryStreamMessage(
                type="telemetry_update",
                payload=record,
            )
            await ws_manager.broadcast(message)

    return data
