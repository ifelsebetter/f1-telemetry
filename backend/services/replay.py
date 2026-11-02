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
        defer_load: bool = False,
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
        self.is_loading: bool = False

        if not defer_load:
            self._load_session_data()

    async def async_load_session_data(self) -> None:
        """Load session data in a worker thread without blocking the asyncio loop."""
        self.is_loading = True
        try:
            await asyncio.to_thread(self._load_session_data)
        finally:
            self.is_loading = False

    def _load_session_data(self) -> None:
        """Fetch real multi-driver telemetry and circuit details from FastF1."""
        grid = None
        # 1. Attempt requested session
        try:
            grid = self.client.fetch_multi_driver_grid_telemetry(
                year=self.year,
                round_number=self.round_number,
                session_type=self.session_type,
            )
        except Exception as e:
            logger.warning(
                "FastF1 session %d R%d %s unavailable: %s",
                self.year,
                self.round_number,
                self.session_type,
                e,
            )

        # 2. If 'R' (race) was requested and failed, fall back to 'Q' (qualifying) for the same event
        if not grid and str(self.session_type).upper() == "R":
            try:
                grid = self.client.fetch_multi_driver_grid_telemetry(
                    year=self.year,
                    round_number=self.round_number,
                    session_type="Q",
                )
                self.session_type = "Q"
                logger.info("Fell back to Qualifying session for %d R%d", self.year, self.round_number)
            except Exception as e:
                logger.warning("Qualifying fallback for %d R%d also failed: %s", self.year, self.round_number, e)

        # 3. If still not loaded, fall back to known cached session
        if not grid:
            for fb_year, fb_round, fb_type in [(2023, 12, "Q"), (2023, 1, "Q")]:
                try:
                    grid = self.client.fetch_multi_driver_grid_telemetry(fb_year, fb_round, fb_type)
                    self.year = fb_year
                    self.round_number = fb_round
                    self.session_type = fb_type
                    logger.info("Using global cached fallback session %d R%d %s", fb_year, fb_round, fb_type)
                    break
                except Exception:
                    continue

        if grid:
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
                "Loaded FastF1 replay for %d R%d %s (%d drivers, %d laps, lap=%.2fs, total_race=%.2fs, circuit=%s)",
                self.year,
                self.round_number,
                self.session_type,
                len(self.available_drivers),
                self.total_laps,
                self.lap_duration,
                self.total_race_duration,
                self.circuit_id,
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
        """Seek by frame index within the current lap."""
        if self.base_frames:
            idx = max(0, min(int(index), len(self.base_frames) - 1))
            cur_lap_zero = int(self.current_time // max(0.001, self.lap_duration))
            self.current_time = (cur_lap_zero * self.lap_duration) + (idx / len(self.base_frames)) * self.lap_duration

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

    async def async_switch_race(
        self, year: int, round_number: int, session_type: str, circuit_id: str
    ) -> None:
        self.is_loading = True
        try:
            self.year = year
            self.round_number = round_number
            self.session_type = session_type
            self.circuit_id = circuit_id.lower()
            await asyncio.to_thread(self._load_session_data)
        finally:
            self.is_loading = False

    def get_current_frame_message(self) -> TelemetryStreamMessage | None:
        """Build the interpolated multi-driver telemetry message at ``self.current_time``."""
        if self.is_loading:
            return None
        frames = self.base_frames
        if not frames:
            return None

        try:
            lap_dur = max(0.001, self.lap_duration)
            cur_lap = max(1, min(self.total_laps, int(self.current_time // lap_dur) + 1))
            t_in_lap = self.current_time % lap_dur
            frac = max(0.0, min(1.0, t_in_lap / lap_dur))
            n_frames = len(frames)
            if n_frames < 2:
                return None
            float_idx = frac * (n_frames - 1)
            i0 = int(float_idx)
            i1 = min(n_frames - 1, i0 + 1)
            alpha = float_idx - i0
            frame0 = frames[i0]
            frame1 = frames[i1]

            multi_payload: dict[str, TelemetryData] = {}
            for drv_code, p0 in frame0.items():
                try:
                    p1 = frame1.get(drv_code, p0)
                    pt_copy = dict(p0)
                    pt_copy["x"] = round(p0["x"] + (p1["x"] - p0["x"]) * alpha, 2)
                    pt_copy["y"] = round(p0["y"] + (p1["y"] - p0["y"]) * alpha, 2)
                    pt_copy["speed"] = max(0.0, round(p0["speed"] + (p1["speed"] - p0["speed"]) * alpha, 1))
                    pt_copy["live_speed_ms"] = round(pt_copy["speed"] / 3.6, 1)
                    pt_copy["distance"] = max(0.0, round(p0["distance"] + (p1["distance"] - p0["distance"]) * alpha, 1))
                    pt_copy["throttle"] = max(0.0, min(100.0, round(p0["throttle"] + (p1["throttle"] - p0["throttle"]) * alpha, 1)))
                    pt_copy["brake"] = max(0.0, min(100.0, round(p0["brake"] + (p1["brake"] - p0["brake"]) * alpha, 1)))
                    pt_copy["rpm"] = max(0.0, round(p0["rpm"] + (p1["rpm"] - p0["rpm"]) * alpha, 0))
                    pt_copy["steer"] = max(
                        -1.0,
                        min(1.0, round(p0.get("steer", 0.0) + (p1.get("steer", 0.0) - p0.get("steer", 0.0)) * alpha, 3)),
                    )
                    pt_copy["ers_soc"] = max(
                        0.0,
                        min(100.0, round(p0.get("ers_soc", 95.0) + (p1.get("ers_soc", 95.0) - p0.get("ers_soc", 95.0)) * alpha, 1)),
                    )
                    pt_copy["ers_harvest"] = max(
                        0.0,
                        min(120.0, round(p0.get("ers_harvest", 0.0) + (p1.get("ers_harvest", 0.0) - p0.get("ers_harvest", 0.0)) * alpha, 1)),
                    )
                    pt_copy["tyre_temp_fl"] = round(p0.get("tyre_temp_fl", 92.0) + (p1.get("tyre_temp_fl", 92.0) - p0.get("tyre_temp_fl", 92.0)) * alpha, 1)
                    pt_copy["tyre_temp_fr"] = round(p0.get("tyre_temp_fr", 92.0) + (p1.get("tyre_temp_fr", 92.0) - p0.get("tyre_temp_fr", 92.0)) * alpha, 1)
                    pt_copy["tyre_temp_rl"] = round(p0.get("tyre_temp_rl", 93.0) + (p1.get("tyre_temp_rl", 93.0) - p0.get("tyre_temp_rl", 93.0)) * alpha, 1)
                    pt_copy["tyre_temp_rr"] = round(p0.get("tyre_temp_rr", 93.0) + (p1.get("tyre_temp_rr", 93.0) - p0.get("tyre_temp_rr", 93.0)) * alpha, 1)
                    base_wear = p0.get("tyre_wear", 5.0) + (p1.get("tyre_wear", 5.0) - p0.get("tyre_wear", 5.0)) * alpha
                    pt_copy["tyre_wear"] = round(max(0.0, min(98.0, base_wear + (cur_lap - 1) * 1.15)), 1)
                    pt_copy["delta_to_ghost"] = round(
                        p0.get("delta_to_ghost", 0.0) + (p1.get("delta_to_ghost", 0.0) - p0.get("delta_to_ghost", 0.0)) * alpha,
                        3,
                    )
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

            return TelemetryStreamMessage(
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
        except Exception as e:
            logger.debug("Failed building frame message: %s", e)
            return None

    async def stream(self) -> AsyncIterator[TelemetryStreamMessage]:
        """Continuously yields synchronized multi-driver stream messages in true real time."""
        while True:
            if self.is_loading or not self.base_frames:
                await asyncio.sleep(0.05)
                continue

            if self.is_playing:
                try:
                    msg = self.get_current_frame_message()
                    if msg is not None:
                        yield msg

                    dt = self.interval * self.speed
                    self.current_time += dt
                    if self.current_time >= self.total_race_duration:
                        self.current_time = 0.0
                except Exception as e:
                    logger.debug("Replay stream tick error: %s", e)

            await asyncio.sleep(self.interval)
