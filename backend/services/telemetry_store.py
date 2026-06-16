"""In-memory telemetry storage.

Provides a dict-backed store keyed by ``(year, round, session_type)`` tuples.
All mutating operations are guarded by an ``asyncio.Lock`` for safe concurrent
access from multiple request handlers.

The interface is deliberately minimal so that a Redis- or Postgres-backed
implementation can drop in as a replacement without changing callers.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from backend.models.schemas import (
    SessionInfo,
    TelemetryData,
    TelemetryQuery,
    TelemetryResponse,
)

logger = logging.getLogger(__name__)

SessionKey = tuple[int, int, str]


class TelemetryStore:
    """Thread-safe, in-memory telemetry store."""

    def __init__(self) -> None:
        self._data: dict[SessionKey, list[TelemetryData]] = {}
        self._session_info: dict[SessionKey, SessionInfo] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Write path
    # ------------------------------------------------------------------

    async def store_telemetry(
        self,
        year: int,
        round_number: int,
        session_type: str,
        data: list[TelemetryData],
        event_name: str = "",
    ) -> None:
        """Insert or replace telemetry for a session."""
        key: SessionKey = (year, round_number, session_type)
        async with self._lock:
            self._data[key] = data
            self._session_info[key] = SessionInfo(
                year=year,
                round=round_number,
                session_type=session_type,
                event_name=event_name,
            )
        logger.info(
            "Stored %d records for session %s",
            len(data),
            key,
        )

    # ------------------------------------------------------------------
    # Read path
    # ------------------------------------------------------------------

    async def query_telemetry(
        self,
        query: TelemetryQuery,
    ) -> TelemetryResponse:
        """Filter stored telemetry by the parameters in *query*."""
        key: SessionKey = (query.year, query.round, query.session_type)

        async with self._lock:
            records = list(self._data.get(key, []))

        # --- lap filter ---
        if query.lap is not None:
            records = [r for r in records if r.lap == query.lap]

        # --- time-window filter ---
        if query.start_time is not None:
            records = [r for r in records if r.timestamp >= query.start_time]
        if query.end_time is not None:
            records = [r for r in records if r.timestamp <= query.end_time]

        # --- field projection ---
        if query.fields:
            allowed = set(query.fields) | {"timestamp", "lap"}
            _defaults = {
                "speed": 0.0,
                "throttle": 0.0,
                "brake": 0.0,
                "gear": 0,
                "rpm": 0.0,
            }
            records = [
                TelemetryData(
                    **{
                        k: (v if k in allowed else _defaults.get(k, v))
                        for k, v in r.model_dump().items()
                    }
                )
                for r in records
            ]

        summary = self._compute_summary(records)
        return TelemetryResponse(data=records, summary=summary)

    async def list_sessions(self) -> list[SessionInfo]:
        """Return metadata for every stored session."""
        async with self._lock:
            return list(self._session_info.values())

    async def has_session(
        self,
        year: int,
        round_number: int,
        session_type: str,
    ) -> bool:
        key: SessionKey = (year, round_number, session_type)
        async with self._lock:
            return key in self._data

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_summary(records: list[TelemetryData]) -> dict[str, Any]:
        """Derive aggregate statistics from a record list."""
        if not records:
            return {}

        speeds = [r.speed for r in records]
        rpms = [r.rpm for r in records]
        brakes = [r.brake for r in records]

        return {
            "total_samples": len(records),
            "avg_speed_kmh": round(sum(speeds) / len(speeds), 2),
            "max_speed_kmh": round(max(speeds), 2),
            "min_speed_kmh": round(min(speeds), 2),
            "avg_rpm": round(sum(rpms) / len(rpms), 2),
            "max_rpm": round(max(rpms), 2),
            "brake_application_pct": round(
                sum(1 for b in brakes if b > 0) / len(brakes) * 100, 2
            ),
        }
