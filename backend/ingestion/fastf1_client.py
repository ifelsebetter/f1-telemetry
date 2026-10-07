"""FastF1 client — wraps the ``fastf1`` library to fetch telemetry data.

Isolates all FastF1 interaction behind a single source of truth for
sessions, driver results, circuit geometry, and multi-driver telemetry.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import fastf1
import numpy as np
import pandas as pd

from backend.config import settings

logger = logging.getLogger(__name__)


def _build_rotation_matrix(angle_degrees: float) -> np.ndarray:
    """Build 2D rotation matrix for track alignment in radians."""
    rad = np.deg2rad(angle_degrees)
    return np.array([
        [np.cos(rad), np.sin(rad)],
        [-np.sin(rad), np.cos(rad)],
    ])


class FastF1Client:
    """Single source of truth client wrapping FastF1."""

    def __init__(self, cache_dir: str | None = None) -> None:
        cache_path = cache_dir or settings.fastf1_cache_dir
        Path(cache_path).mkdir(parents=True, exist_ok=True)
        try:
            fastf1.Cache.enable_cache(cache_path)
            logger.info("FastF1 cache enabled at %s", cache_path)
        except Exception as e:
            logger.warning("Could not enable FastF1 cache: %s", e)

    def load_session(
        self,
        year: int,
        round_number: int | str,
        session_type: str,
    ) -> fastf1.core.Session:
        """Load session with telemetry and laps."""
        session = fastf1.get_session(year, round_number, session_type)
        session.load(telemetry=True, laps=True, weather=False, messages=False)
        return session

    def extract_driver_results(self, session: fastf1.core.Session) -> list[dict[str, Any]]:
        """Extract official driver grid and results from session.results."""
        results: list[dict[str, Any]] = []
        if not hasattr(session, "results") or session.results is None or session.results.empty:
            return results

        for _, row in session.results.iterrows():
            drv = str(row.get("Abbreviation", "")).strip().upper()
            if not drv or drv == "NAN":
                continue

            raw_color = str(row.get("TeamColor", "")).strip()
            if not raw_color or raw_color == "nan":
                color = "#3671C6"
            elif not raw_color.startswith("#"):
                color = f"#{raw_color}"
            else:
                color = raw_color

            num_str = str(row.get("DriverNumber", "0"))
            num = int(num_str) if num_str.isdigit() else 0
            pos = row.get("Position")
            pos_int = int(pos) if pd.notna(pos) else None

            results.append({
                "driver": drv,
                "number": num,
                "full_name": str(row.get("FullName", drv)),
                "team": str(row.get("TeamName", "F1 Team")),
                "team_color": color,
                "position": pos_int,
            })
        return results

    def extract_circuit_details(self, session: fastf1.core.Session) -> dict[str, Any]:
        """Extract authentic circuit layout, corners, and DRS zones from FastF1."""
        cinfo = session.get_circuit_info()
        rot_angle = float(cinfo.rotation)
        rot_mat = _build_rotation_matrix(rot_angle)

        flap = session.laps.pick_fastest()
        tel = flap.get_telemetry()
        if tel.empty:
            raise ValueError("No telemetry found on session fastest lap")

        # Rotate car path into official F1 track orientation
        raw_xy = tel[["X", "Y"]].to_numpy()
        rot_xy = np.matmul(raw_xy, rot_mat)

        # Downsample waypoints for optimal web streaming & canvas rendering
        step = max(1, len(tel) // 400)
        down_tel = tel.iloc[::step].copy()
        down_coords = rot_xy[::step]

        s1_time = flap.get("Sector1Time")
        s2_time = flap.get("Sector2Time")

        waypoints: list[dict[str, Any]] = []
        for i, (_, row) in enumerate(down_tel.iterrows()):
            rx, ry = down_coords[i]
            drs_val = int(row.get("DRS", 0)) if pd.notna(row.get("DRS")) else 0
            drs_active = drs_val in (10, 12, 14)

            sec = 1
            t = row.get("Time")
            if pd.notna(s1_time) and pd.notna(t):
                if t > s1_time:
                    sec = 2
                if pd.notna(s2_time) and t > (s1_time + s2_time):
                    sec = 3

            waypoints.append({
                "x": round(float(rx), 2),
                "y": round(float(ry), 2),
                "distance": round(float(row.get("Distance", 0.0)), 1),
                "speed": round(float(row.get("Speed", 0.0)), 1),
                "gear": int(row.get("nGear", 0)) if pd.notna(row.get("nGear")) else 0,
                "drs": drs_active,
                "sector": sec,
            })

        # Corners
        corners: list[dict[str, Any]] = []
        if hasattr(cinfo, "corners") and cinfo.corners is not None and not cinfo.corners.empty:
            for _, c in cinfo.corners.iterrows():
                c_xy = np.array([[float(c["X"]), float(c["Y"])]])
                rot_c = np.matmul(c_xy, rot_mat)[0]
                turn_num = int(c["Number"])
                letter = str(c.get("Letter", "")) if pd.notna(c.get("Letter")) else ""
                corners.append({
                    "turn": turn_num,
                    "letter": letter,
                    "name": f"T{turn_num}{letter}",
                    "x": round(float(rot_c[0]), 2),
                    "y": round(float(rot_c[1]), 2),
                    "angle": float(c.get("Angle", 0.0)),
                    "distance": float(c.get("Distance", 0.0)),
                })

        event = session.event
        event_name = str(event.get("EventName", "Grand Prix"))
        circuit_slug = (
            event_name.lower()
            .replace(" grand prix", "")
            .replace("gp", "")
            .strip()
            .replace(" ", "_")
        )
        if not circuit_slug:
            circuit_slug = "bahrain"

        max_dist = float(tel["Distance"].max()) if "Distance" in tel else 5000.0
        return {
            "id": circuit_slug,
            "name": event_name,
            "location": str(event.get("Location", "")),
            "country": str(event.get("Country", "")),
            "length_km": round(max_dist / 1000.0, 3),
            "laps": int(event.get("RoundNumber", 50)),
            "turns_count": len(corners),
            "waypoints": waypoints,
            "turns": corners,
            "drs_zones": [{"zone": 1, "name": "DRS Zone 1"}, {"zone": 2, "name": "DRS Zone 2"}],
            "rotation": rot_angle,
        }

    def fetch_driver_fastest_lap_telemetry(
        self,
        session: fastf1.core.Session,
        driver: str,
        rot_mat: np.ndarray | None = None,
    ) -> list[dict[str, Any]]:
        """Extract and rotate fastest lap telemetry records for a single driver."""
        driver_upper = driver.strip().upper()
        driver_laps = session.laps[session.laps["Driver"] == driver_upper]
        if driver_laps.empty:
            logger.warning("No laps found for driver %s", driver_upper)
            return []

        try:
            flap = driver_laps.pick_fastest()
            tel = flap.get_telemetry()
        except Exception as e:
            logger.warning("Could not pick fastest lap for %s: %s", driver_upper, e)
            return []

        if tel.empty:
            return []

        if rot_mat is None:
            cinfo = session.get_circuit_info()
            rot_mat = _build_rotation_matrix(float(cinfo.rotation))

        raw_xy = tel[["X", "Y"]].to_numpy()
        rot_xy = np.matmul(raw_xy, rot_mat)

        s1_time = flap.get("Sector1Time")
        s2_time = flap.get("Sector2Time")
        lap_num = int(flap.get("LapNumber", 1))

        lap_duration = float(flap["LapTime"].total_seconds()) if pd.notna(flap.get("LapTime")) else 90.0
        max_dist = float(tel["Distance"].max()) if "Distance" in tel else 5000.0

        records: list[dict[str, Any]] = []
        for i, (_, row) in enumerate(tel.iterrows()):
            rx, ry = rot_xy[i]
            drs_val = int(row.get("DRS", 0)) if pd.notna(row.get("DRS")) else 0
            drs_active = drs_val in (10, 12, 14)

            sec = 1
            t = row.get("Time")
            t_sec = float(t.total_seconds()) if hasattr(t, "total_seconds") else float(t or 0)
            if pd.notna(s1_time) and pd.notna(t):
                if t > s1_time:
                    sec = 2
                if pd.notna(s2_time) and t > (s1_time + s2_time):
                    sec = 3

            spd = round(float(row.get("Speed", 0.0)), 1)
            dist_val = round(float(row.get("Distance", 0.0)), 1)

            records.append({
                "timestamp": t_sec,
                "lap": lap_num,
                "speed": spd,
                "live_speed_ms": round(spd / 3.6, 1),
                "throttle": round(float(row.get("Throttle", 0.0)), 1),
                "brake": 100.0 if bool(row.get("Brake", False)) else 0.0,
                "gear": int(row.get("nGear", 0)) if pd.notna(row.get("nGear")) else 0,
                "rpm": round(float(row.get("RPM", 0.0)), 0),
                "x": round(float(rx), 2),
                "y": round(float(ry), 2),
                "z": round(float(row.get("Z", 0.0)), 2) if pd.notna(row.get("Z")) else 0.0,
                "steer": 0.0,
                "ers_soc": 100.0,
                "ers_harvest": 0.0,
                "tyre_temp_fl": 90.0,
                "tyre_temp_fr": 90.0,
                "tyre_temp_rl": 90.0,
                "tyre_temp_rr": 90.0,
                "tyre_wear": 5.0,
                "tyre_compound": str(flap.get("Compound", "SOFT")),
                "drs": drs_active,
                "flag": "GREEN",
                "safety_car": "NONE",
                "delta_to_ghost": 0.0,
                "sector": sec,
                "mini_sector": 1,
                "distance": dist_val,
                "dist_remaining": max(0.0, round(max_dist - dist_val, 1)),
                "eta_seconds": max(0.0, round(lap_duration - t_sec, 2)),
            })
        return records

    def fetch_multi_driver_grid_telemetry(
        self,
        year: int,
        round_number: int | str,
        session_type: str,
        steps: int = 1500,
    ) -> dict[str, Any]:
        """Extract synchronized multi-driver telemetry across common lap distance grid.

        Returns {
            'circuit': circuit_details,
            'results': driver_results,
            'drivers': list_of_driver_codes,
            'primary_driver': fastest_driver,
            'lap_duration': seconds,
            'grid_data': list_of_frames_where_each_is_dict_of_drivers,
        }
        """
        session = self.load_session(year, round_number, session_type)
        circuit = self.extract_circuit_details(session)
        results = self.extract_driver_results(session)

        cinfo = session.get_circuit_info()
        rot_mat = _build_rotation_matrix(float(cinfo.rotation))

        flap = session.laps.pick_fastest()
        ref_tel = flap.get_telemetry()
        max_dist = float(ref_tel["Distance"].max())
        lap_duration = float(flap["LapTime"].total_seconds())
        primary_driver = str(flap["Driver"])

        # Create uniform reference distance grid
        dist_grid = np.linspace(0, max_dist, steps)
        time_grid = np.linspace(0, lap_duration, steps)

        s1_time = float(flap["Sector1Time"].total_seconds()) if pd.notna(flap.get("Sector1Time")) else lap_duration * 0.33
        s2_time = float(flap["Sector2Time"].total_seconds()) if pd.notna(flap.get("Sector2Time")) else lap_duration * 0.33

        driver_interpolated: dict[str, dict[str, Any]] = {}
        valid_drivers: list[str] = []

        for drv in session.laps["Driver"].unique():
            laps = session.laps[session.laps["Driver"] == drv]
            if laps.empty:
                continue
            try:
                dl = laps.pick_fastest()
                dtel = dl.get_telemetry()
                if dtel.empty or "Distance" not in dtel:
                    continue
                coords = np.matmul(dtel[["X", "Y"]].to_numpy(), rot_mat)
                dtel["RotX"] = coords[:, 0]
                dtel["RotY"] = coords[:, 1]

                d_dist = dtel["Distance"].to_numpy()
                d_speed = dtel["Speed"].to_numpy()
                d_x = dtel["RotX"].to_numpy()
                d_y = dtel["RotY"].to_numpy()
                d_throttle = dtel["Throttle"].to_numpy()
                d_brake = (dtel["Brake"].to_numpy() == True).astype(float) * 100.0
                d_gear = dtel["nGear"].to_numpy()
                d_rpm = dtel["RPM"].to_numpy()
                d_drs = dtel["DRS"].isin([10, 12, 14]).to_numpy()

                driver_interpolated[drv] = {
                    "speed": np.interp(dist_grid, d_dist, d_speed),
                    "x": np.interp(dist_grid, d_dist, d_x),
                    "y": np.interp(dist_grid, d_dist, d_y),
                    "throttle": np.interp(dist_grid, d_dist, d_throttle),
                    "brake": np.interp(dist_grid, d_dist, d_brake),
                    "gear": np.round(np.interp(dist_grid, d_dist, d_gear)).astype(int),
                    "rpm": np.interp(dist_grid, d_dist, d_rpm),
                    "drs": np.interp(dist_grid, d_dist, d_drs.astype(float)) > 0.5,
                    "compound": str(dl.get("Compound", "SOFT")),
                }
                valid_drivers.append(drv)
            except Exception:
                continue

        # Build list of 600 frames
        frames: list[dict[str, Any]] = []
        for i in range(steps):
            t = round(float(time_grid[i]), 3)
            dist = round(float(dist_grid[i]), 1)
            dist_rem = max(0.0, round(max_dist - dist, 1))
            eta = max(0.0, round(lap_duration - t, 2))
            sec = 1
            if t > s1_time:
                sec = 2
            if t > (s1_time + s2_time):
                sec = 3

            frame_multi: dict[str, dict[str, Any]] = {}
            for drv, ddata in driver_interpolated.items():
                drv_spd = round(float(ddata["speed"][i]), 1)
                frame_multi[drv] = {
                    "timestamp": t,
                    "lap": 1,
                    "speed": drv_spd,
                    "live_speed_ms": round(drv_spd / 3.6, 1),
                    "throttle": round(float(ddata["throttle"][i]), 1),
                    "brake": round(float(ddata["brake"][i]), 1),
                    "gear": int(ddata["gear"][i]),
                    "rpm": round(float(ddata["rpm"][i]), 0),
                    "x": round(float(ddata["x"][i]), 2),
                    "y": round(float(ddata["y"][i]), 2),
                    "z": 0.0,
                    "steer": 0.0,
                    "ers_soc": 100.0,
                    "ers_harvest": 0.0,
                    "tyre_temp_fl": 90.0,
                    "tyre_temp_fr": 90.0,
                    "tyre_temp_rl": 90.0,
                    "tyre_temp_rr": 90.0,
                    "tyre_wear": 5.0,
                    "tyre_compound": ddata["compound"],
                    "drs": bool(ddata["drs"][i]),
                    "flag": "GREEN",
                    "safety_car": "NONE",
                    "delta_to_ghost": 0.0,
                    "sector": sec,
                    "mini_sector": 1,
                    "distance": dist,
                    "dist_remaining": dist_rem,
                    "eta_seconds": eta,
                }
            frames.append(frame_multi)

        total_laps = int(session.laps["LapNumber"].max()) if not session.laps.empty else 50
        total_race_duration = round(total_laps * lap_duration, 2)

        return {
            "circuit": circuit,
            "results": results,
            "drivers": valid_drivers,
            "primary_driver": primary_driver,
            "lap_duration": lap_duration,
            "total_laps": total_laps,
            "total_race_duration": total_race_duration,
            "frames": frames,
        }

    def fetch_session_telemetry(
        self,
        year: int,
        round_number: int | str,
        session_type: str,
        driver: str | None = None,
    ) -> tuple[list[dict[str, Any]], str, int, str]:
        """Fetch telemetry for session driver. Returns (records, driver, round, event_name)."""
        try:
            session = self.load_session(year, round_number, session_type)
        except Exception:
            logger.exception("Failed to load session %s/%s/%s", year, round_number, session_type)
            return [], "", 0, ""

        resolved_round = int(session.event["RoundNumber"])
        event_name = str(session.event["EventName"])

        resolved_driver = ""
        if driver:
            d_upper = driver.strip().upper()
            if d_upper in session.laps["Driver"].unique():
                resolved_driver = d_upper

        if not resolved_driver:
            try:
                resolved_driver = str(session.laps.pick_fastest()["Driver"])
            except Exception:
                drivers = session.laps["Driver"].unique()
                resolved_driver = str(drivers[0]) if len(drivers) > 0 else "VER"

        records = self.fetch_driver_fastest_lap_telemetry(session, resolved_driver)
        return records, resolved_driver, resolved_round, event_name

    def list_available_sessions(self, year: int) -> list[dict[str, Any]]:
        """Return official schedule and sessions for a season."""
        try:
            schedule = fastf1.get_event_schedule(year)
        except Exception:
            logger.exception("Failed to load schedule for %s", year)
            return []

        records: list[dict[str, Any]] = []
        for _, event in schedule.iterrows():
            rnd = int(event["RoundNumber"]) if pd.notna(event.get("RoundNumber")) else 0
            if rnd <= 0:
                continue
            ev_name = str(event["EventName"])
            circuit_slug = (
                ev_name.lower()
                .replace(" grand prix", "")
                .replace("gp", "")
                .strip()
                .replace(" ", "_")
            )
            sessions = [
                s
                for s in ["FP1", "FP2", "FP3", "Q", "S", "SS", "SQ", "R"]
                if s in event.index and pd.notna(event.get(s))
            ]
            records.append({
                "year": year,
                "round": rnd,
                "event_name": ev_name,
                "location": str(event.get("Location", "")),
                "country": str(event.get("Country", "")),
                "circuit_id": circuit_slug,
                "sessions": sessions,
            })
        return records
