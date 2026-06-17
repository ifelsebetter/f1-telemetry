"""In-memory telemetry storage.

Provides a dict-backed store keyed by ``(year, round, session_type, driver)`` tuples.
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

SessionKey = tuple[int, int, str, str]


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
        driver: str,
        data: list[TelemetryData],
        event_name: str = "",
    ) -> None:
        """Insert or replace telemetry for a session and driver."""
        driver_upper = driver.upper()
        key: SessionKey = (year, round_number, session_type, driver_upper)
        async with self._lock:
            self._data[key] = data
            self._session_info[key] = SessionInfo(
                year=year,
                round=round_number,
                session_type=session_type,
                event_name=event_name,
                driver=driver_upper,
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
        year = query.year
        round_val = query.round
        s_type = query.session_type
        driver_val = query.driver.upper() if query.driver else None

        records: list[TelemetryData] = []
        resolved_driver = driver_val or ""
        event_name = ""
        async with self._lock:
            if driver_val:
                session_key = (year, round_val, s_type, driver_val)
                if session_key in self._data:
                    records = list(self._data[session_key])
                if session_key in self._session_info:
                    event_name = self._session_info[session_key].event_name
                    resolved_driver = self._session_info[session_key].driver
            else:
                for k, val in self._data.items():
                    if k[0] == year and k[1] == round_val and k[2] == s_type:
                        records = list(val)
                        if k in self._session_info:
                            event_name = self._session_info[k].event_name
                            resolved_driver = self._session_info[k].driver
                        break

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
        return TelemetryResponse(
            data=records,
            summary=summary,
            year=year,
            round=round_val,
            session_type=s_type,
            event_name=event_name,
            driver=resolved_driver,
        )

    async def list_sessions(self) -> list[SessionInfo]:
        """Return metadata for every stored session."""
        async with self._lock:
            return list(self._session_info.values())

    async def has_session(
        self,
        year: int,
        round_number: int,
        session_type: str,
        driver: str | None = None,
    ) -> bool:
        async with self._lock:
            driver_upper = driver.upper() if driver else None
            for key in self._data:
                if key[0] == year and key[1] == round_number and key[2] == session_type:
                    if driver_upper is None or key[3] == driver_upper:
                        return True
            return False

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
