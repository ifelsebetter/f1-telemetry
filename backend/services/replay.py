"""High-frequency telemetry replay engine backed exclusively by FastF1.

Streams synchronized multi-driver qualifying and full race sessions with real-time controls:
play, pause, seek across full race distance, speed multipliers, and dynamic circuit/driver switching.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator

from backend.ingestion.fastf1_client import FastF1Client
from backend.models.schemas import TelemetryData, TelemetryStreamMessage
from backend.services.circuit_store import register_circuit

logger = logging.getLogger(__name__)


class ReplayEngine:
    """Manages synchronized multi-driver FastF1 full race telemetry playback in true real time."""

    def __init__(
        self,
        client: FastF1Client | None = None,
        year: int = 2023,
        round_number: int = 12,
        session_type: str = "R",
        circuit_id: str = "spa",
        tick_rate_hz: int = 20,
    ) -> None:
        self.client = client or FastF1Client()
        self.year = year
        self.round_number = round_number
        self.session_type = session_type
        self.circuit_id = circuit_id
        self.primary_driver = "VER"
        self.tick_rate_hz = tick_rate_hz
        self.interval = 1.0 / tick_rate_hz  # 0.05s per tick at 20 Hz

        self.base_frames: list[dict[str, dict[str, Any]]] = []
        self.driver_results: list[dict[str, Any]] = []
        self.is_playing: bool = True
        self.speed: float = 1.0
        self.current_time: float = 0.0  # continuous elapsed race time in seconds
        self.lap_duration: float = 106.17
        self.total_laps: int = 44
        self.total_race_duration: float = 4671.48  # 44 * 106.17s (~1h 18m)
        self.track_length_m: float = 7004.0
        self.available_drivers: list[str] = []

        self._load_session_data()

    def _load_session_data(self) -> None:
        """Fetch real multi-driver telemetry and circuit details from FastF1."""
        try:
            grid = self.client.fetch_multi_driver_grid_telemetry(
                year=self.year,
                round_number=self.round_number,
                session_type=self.session_type,
            )
            self.base_frames = grid.get("frames", [])
            self.driver_results = grid.get("results", [])
            self.available_drivers = grid.get("drivers", [])
            self.lap_duration = float(grid.get("lap_duration", 106.17))
            self.total_laps = int(grid.get("total_laps", 44))
            self.total_race_duration = float(
                grid.get("total_race_duration", self.total_laps * self.lap_duration)
            )
            if grid.get("primary_driver"):
                self.primary_driver = str(grid["primary_driver"])
            if grid.get("circuit"):
                c_details = grid["circuit"]
                self.circuit_id = str(c_details.get("id", self.circuit_id))
                self.track_length_m = float(c_details.get("length_km", 7.004)) * 1000.0
                register_circuit(c_details)

            self.current_time = 0.0
            logger.info(
                "Loaded FastF1 replay for %d R%d %s (%d drivers, %d laps, lap=%.2fs, total_race=%.2fs)",
                self.year,
                self.round_number,
                self.session_type,
                len(self.available_drivers),
                self.total_laps,
                self.lap_duration,
                self.total_race_duration,
            )
        except Exception:
            logger.exception(
                "Failed to load FastF1 telemetry for %d R%d %s",
                self.year,
                self.round_number,
                self.session_type,
            )

    def play(self) -> None:
        self.is_playing = True

    def pause(self) -> None:
        self.is_playing = False

    def seek_to_time(self, timestamp: float) -> None:
        """Seek to specific timestamp anywhere in the full race."""
        self.current_time = max(0.0, min(float(timestamp), self.total_race_duration))

    def seek_to_lap(self, lap_number: int) -> None:
        """Jump directly to the start of a specific lap in the race."""
        lap_clamped = max(1, min(int(lap_number), self.total_laps))
        self.current_time = (lap_clamped - 1) * self.lap_duration

    def seek_to_index(self, index: int) -> None:
        """Seek by frame index."""
        if self.base_frames:
            idx = max(0, min(int(index), len(self.base_frames) - 1))
            self.current_time = (idx / len(self.base_frames)) * self.lap_duration

    def set_speed(self, speed: float) -> None:
        """Set replay playback speed multiplier (1.0 = real-time, 2.0 = 2x, etc.)."""
        if speed > 0:
            self.speed = max(0.1, min(60.0, float(speed)))

    def set_circuit(self, circuit_id: str) -> None:
        self.circuit_id = circuit_id.lower()

    def set_primary_driver(self, driver: str) -> None:
        self.primary_driver = driver.upper()

    def switch_race(self, year: int, round_number: int, session_type: str, circuit_id: str) -> None:
        self.year = year
        self.round_number = round_number
        self.session_type = session_type
        self.circuit_id = circuit_id.lower()
        self._load_session_data()

    async def stream(self) -> AsyncIterator[TelemetryStreamMessage]:
        """Continuously yields synchronized multi-driver stream messages in true real time.

        At 1.0x speed, 1 second of wall-clock time advances exactly 1.0 second of race time.
        A 1m30s lap takes exactly 1 minute 30 seconds; a 44-lap race replays for its full ~1h18m duration.
        """
        while True:
            if not self.base_frames:
                await asyncio.sleep(0.5)
                continue

            if self.is_playing:
                # 1. Compute current lap and progress within current lap
                cur_lap = min(self.total_laps, int(self.current_time // max(0.001, self.lap_duration)) + 1)
                t_in_lap = self.current_time % max(0.001, self.lap_duration)
                frac = t_in_lap / max(0.001, self.lap_duration)
                n_frames = len(self.base_frames)
                float_idx = frac * (n_frames - 1)
                i0 = int(float_idx)
                i1 = min(n_frames - 1, i0 + 1)
                alpha = float_idx - i0
                frame0 = self.base_frames[i0]
                frame1 = self.base_frames[i1]

                # 2. Build synchronized multi-driver payload with continuous interpolation
                multi_payload: dict[str, TelemetryData] = {}
                for drv_code, p0 in frame0.items():
                    try:
                        p1 = frame1.get(drv_code, p0)
                        pt_copy = dict(p0)
                        pt_copy["x"] = round(p0["x"] + (p1["x"] - p0["x"]) * alpha, 2)
                        pt_copy["y"] = round(p0["y"] + (p1["y"] - p0["y"]) * alpha, 2)
                        pt_copy["speed"] = round(p0["speed"] + (p1["speed"] - p0["speed"]) * alpha, 1)
                        pt_copy["live_speed_ms"] = round(pt_copy["speed"] / 3.6, 1)
                        pt_copy["distance"] = round(p0["distance"] + (p1["distance"] - p0["distance"]) * alpha, 1)
                        pt_copy["throttle"] = round(p0["throttle"] + (p1["throttle"] - p0["throttle"]) * alpha, 1)
                        pt_copy["brake"] = round(p0["brake"] + (p1["brake"] - p0["brake"]) * alpha, 1)
                        pt_copy["rpm"] = round(p0["rpm"] + (p1["rpm"] - p0["rpm"]) * alpha, 0)
                        pt_copy["timestamp"] = round(self.current_time, 2)
                        pt_copy["lap"] = cur_lap
                        pt_copy["lap_time"] = round(t_in_lap, 2)
                        pt_copy["race_time"] = round(self.current_time, 2)
                        pt_copy["total_laps"] = self.total_laps
                        pt_copy["total_race_duration"] = round(self.total_race_duration, 2)
                        pt_copy["eta_seconds"] = round(max(0.0, self.lap_duration - t_in_lap), 2)
                        pt_copy["race_eta_seconds"] = round(
                            max(0.0, self.total_race_duration - self.current_time), 2
                        )
                        multi_payload[drv_code] = TelemetryData(**pt_copy)
                    except Exception:
                        continue

                primary = multi_payload.get(self.primary_driver)
                if not primary and multi_payload:
                    primary = next(iter(multi_payload.values()))

                msg = TelemetryStreamMessage(
                    type="telemetry_update",
                    payload=primary,
                    multi_payload=multi_payload,
                    year=self.year,
                    round=self.round_number,
                    session_type=self.session_type,
                    driver=self.primary_driver,
                    circuit_id=self.circuit_id,
                    lap_duration=round(self.lap_duration, 2),
                    track_length_m=round(self.track_length_m, 1),
                    current_lap=cur_lap,
                    total_laps=self.total_laps,
                    race_time=round(self.current_time, 2),
                    total_race_duration=round(self.total_race_duration, 2),
                    race_eta_seconds=round(
                        max(0.0, self.total_race_duration - self.current_time), 2
                    ),
                )
                yield msg

                # 3. Advance race time by true real-time delta: dt * speed
                # At speed=1.0, 1 wall-clock second = 1 race second.
                dt = self.interval * self.speed
                self.current_time += dt
                if self.current_time >= self.total_race_duration:
                    self.current_time = 0.0  # Finished race: loop from start

            # 4. Pace updates accurately to real wall-clock time
            await asyncio.sleep(self.interval)
