"""FastF1 client — wraps the ``fastf1`` library to fetch telemetry data.

This module isolates all FastF1 interaction behind a clean interface so that
the rest of the application never imports ``fastf1`` directly.  This makes it
straightforward to swap the data source later (e.g., for a live timing feed).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import fastf1
import pandas as pd

from backend.config import settings

logger = logging.getLogger(__name__)


class FastF1Client:
    """Thin wrapper around the ``fastf1`` session/telemetry API."""

    def __init__(self, cache_dir: str | None = None) -> None:
        cache_path = cache_dir or settings.fastf1_cache_dir
        Path(cache_path).mkdir(parents=True, exist_ok=True)
        fastf1.Cache.enable_cache(cache_path)
        logger.info("FastF1 cache enabled at %s", cache_path)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fetch_session_telemetry(
        self,
        year: int,
        round_number: int | str,
        session_type: str,
        driver: str | None = None,
    ) -> tuple[list[dict[str, Any]], str, int, str]:
        """Fetch telemetry for every lap in a session for a driver.

        Returns a tuple: (records, driver_code, resolved_round, event_name)
        """
        try:
            session = fastf1.get_session(year, round_number, session_type)
            resolved_round = int(session.event["RoundNumber"])
            event_name = str(session.event["EventName"])
        except Exception:
            logger.exception(
                "Failed to load session metadata for %s/%s/%s",
                year,
                round_number,
                session_type,
            )
            return [], "", 0, ""

        try:
            session.load(telemetry=True, weather=False, messages=False)
        except Exception:
            logger.exception(
                "Failed to load telemetry for session %s/%s/%s",
                year,
                round_number,
                session_type,
            )
            return [], "", resolved_round, event_name

        if session.laps.empty:
            logger.warning("No laps found in session %s/%s/%s", year, round_number, session_type)
            return [], "", resolved_round, event_name

        resolved_driver = ""
        driver_laps = None

        if driver:
            driver_upper = driver.strip().upper()
            unique_drivers = session.laps["Driver"].unique()
            if driver_upper in unique_drivers:
                resolved_driver = driver_upper
                driver_laps = session.laps.pick_driver(resolved_driver)
                logger.info("Selected requested driver %s for telemetry ingestion", resolved_driver)

        if driver_laps is None:
            try:
                fastest_lap = session.laps.pick_fastest()
                resolved_driver = fastest_lap["Driver"]
                driver_laps = session.laps.pick_driver(resolved_driver)
                logger.info("Selected driver %s for telemetry ingestion", resolved_driver)
            except Exception:
                resolved_driver = session.laps["Driver"].iloc[0]
                driver_laps = session.laps.pick_driver(resolved_driver)
                logger.info("Selected fallback driver %s for telemetry ingestion", resolved_driver)

        all_records: list[dict[str, Any]] = []
        for lap_number in driver_laps["LapNumber"].unique():
            lap = driver_laps.pick_laps(lap_number)
            try:
                telemetry: pd.DataFrame = lap.get_telemetry()
            except Exception:
                logger.warning(
                    "No telemetry for lap %s in %s/%s/%s",
                    lap_number,
                    year,
                    round_number,
                    session_type,
                )
                continue

            if telemetry.empty:
                continue

            telemetry = telemetry.copy()
            telemetry["LapNumber"] = int(lap_number)

            records = telemetry.to_dict(orient="records")
            all_records.extend(records)

        logger.info(
            "Fetched %d telemetry records for %s/%s/%s (driver=%s)",
            len(all_records),
            year,
            round_number,
            session_type,
            resolved_driver,
        )
        return all_records, resolved_driver, resolved_round, event_name

    def list_available_sessions(self, year: int) -> list[dict[str, Any]]:
        """Return metadata for all sessions in a given season.

        Each dict contains ``RoundNumber``, ``EventName``, and the
        session identifiers (``FP1``, ``Q``, ``R``, etc.).
        """
        try:
            schedule = fastf1.get_event_schedule(year)
        except Exception:
            logger.exception("Failed to load schedule for %s", year)
            return []

        records: list[dict[str, Any]] = []
        for _, event in schedule.iterrows():
            records.append(
                {
                    "year": year,
                    "round": int(event["RoundNumber"]),
                    "event_name": str(event["EventName"]),
                    "sessions": [
                        s
                        for s in [
                            "FP1",
                            "FP2",
                            "FP3",
                            "Q",
                            "S",
                            "SS",
                            "SQ",
                            "R",
                        ]
                        if s in event.index and pd.notna(event.get(s))
                    ],
                }
            )

        logger.info("Found %d events for %s", len(records), year)
        return records
