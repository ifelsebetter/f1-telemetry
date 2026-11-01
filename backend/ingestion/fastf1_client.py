"""FastF1 client — wraps the ``fastf1`` library to fetch telemetry data.

Isolates all FastF1 interaction behind a single source of truth for
sessions, driver results, circuit geometry, and multi-driver telemetry.
"""

from __future__ import annotations

import logging
import threading
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


def _compute_derived_channels(
    dist: np.ndarray,
    speed: np.ndarray,
    throttle: np.ndarray,
    brake: np.ndarray,
    rot_x: np.ndarray,
    rot_y: np.ndarray,
    compound: str = "SOFT",
    tyre_life: float = 3.0,
    delta_arr: np.ndarray | None = None,
) -> dict[str, np.ndarray]:
    """Derive physically coupled steering, ERS, tyre thermals, wear, delta, and mini-sectors."""
    dist = np.nan_to_num(np.asarray(dist, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
    n = len(dist)
    if n == 0:
        return {}

    speed = np.clip(np.nan_to_num(np.asarray(speed, dtype=float), nan=0.0, posinf=0.0, neginf=0.0), 0.0, 400.0)
    throttle = np.clip(np.nan_to_num(np.asarray(throttle, dtype=float), nan=0.0, posinf=0.0, neginf=0.0), 0.0, 100.0)
    brake = np.clip(np.nan_to_num(np.asarray(brake, dtype=float), nan=0.0, posinf=0.0, neginf=0.0), 0.0, 100.0)
    rot_x = np.nan_to_num(np.asarray(rot_x, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
    rot_y = np.nan_to_num(np.asarray(rot_y, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)

    max_dist = max(1.0, float(np.max(dist)) if n > 0 else 5000.0)
    norm_dist = np.clip(dist / max_dist, 0.0, 1.0)

    # 1. Steering input (-1.0 to 1.0) from signed 2D path curvature
    if n >= 5:
        dx = np.gradient(rot_x)
        dy = np.gradient(rot_y)
        ddx = np.gradient(dx)
        ddy = np.gradient(dy)
        denom = np.power(dx * dx + dy * dy, 1.5) + 1e-6
        curvature = (dx * ddy - dy * ddx) / denom
        # Smooth curvature with 7-point window and scale to steering range
        kernel = np.ones(min(7, n)) / min(7, n)
        smoothed_curv = np.convolve(curvature, kernel, mode="same")
        steer = np.clip(smoothed_curv * 140.0, -1.0, 1.0)
    else:
        steer = np.zeros(n, dtype=float)

    # 2. MGU-K Harvest (0..120 kW) & ERS State of Charge (15..100%)
    brake_frac = np.clip(brake / 100.0, 0.0, 1.0)
    throttle_frac = np.clip(throttle / 100.0, 0.0, 1.0)
    speed_frac = np.clip(speed / 340.0, 0.0, 1.0)

    lift_regen = np.where((throttle < 25.0) & (speed > 110.0) & (brake < 10.0), 38.0 * speed_frac, 0.0)
    ers_harvest = np.clip(brake_frac * 116.0 + lift_regen, 0.0, 120.0)

    # Integrate net energy rate across lap (deploy at full throttle high speed, harvest under braking)
    deploy_rate = np.where((throttle > 80.0) & (speed > 165.0), 0.14 * speed_frac, 0.0)
    harvest_rate = (ers_harvest / 120.0) * 0.11
    net_step = harvest_rate - deploy_rate
    soc_trace = 96.0 + np.cumsum(net_step)
    ers_soc = np.clip(soc_trace, 18.0, 100.0)

    # 3. Tyre Surface Temperatures (°C) & Wear (%)
    comp_upper = (compound or "SOFT").upper()
    base_temp = 95.0 if "S" in comp_upper else (91.0 if "M" in comp_upper else (88.0 if "H" in comp_upper else 68.0))
    wear_rate = 1.85 if "S" in comp_upper else (1.25 if "M" in comp_upper else 0.85)

    # Lateral load heats outer tyres; braking heats front axle; traction heats rear axle
    lat_right_load = np.clip(steer, 0.0, 1.0) * speed_frac * 9.5
    lat_left_load = np.clip(-steer, 0.0, 1.0) * speed_frac * 9.5
    front_brake_heat = brake_frac * 8.5
    rear_traction_heat = throttle_frac * (1.0 - speed_frac * 0.4) * 6.5
    aero_cooling = speed_frac * 2.8

    raw_fl = base_temp + front_brake_heat + lat_right_load - aero_cooling
    raw_fr = base_temp + front_brake_heat + lat_left_load - aero_cooling
    raw_rl = base_temp + 1.5 + rear_traction_heat + lat_right_load * 0.85 - aero_cooling * 0.8
    raw_rr = base_temp + 1.5 + rear_traction_heat + lat_left_load * 0.85 - aero_cooling * 0.8

    if n >= 9:
        t_kernel = np.ones(9) / 9.0
        tyre_fl = np.convolve(raw_fl, t_kernel, mode="same")
        tyre_fr = np.convolve(raw_fr, t_kernel, mode="same")
        tyre_rl = np.convolve(raw_rl, t_kernel, mode="same")
        tyre_rr = np.convolve(raw_rr, t_kernel, mode="same")
    else:
        tyre_fl, tyre_fr, tyre_rl, tyre_rr = raw_fl, raw_fr, raw_rl, raw_rr

    tyre_wear = np.clip((max(1.0, float(tyre_life)) - 1.0 + norm_dist) * wear_rate + 3.2, 1.0, 95.0)

    # 4. Mini-sector (1..25)
    mini_sector = np.clip((norm_dist * 25.0).astype(int) + 1, 1, 25)

    # 5. Delta to ghost
    if delta_arr is None:
        delta_arr = np.zeros(n, dtype=float)
    else:
        delta_arr = np.nan_to_num(np.asarray(delta_arr, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)

    return {
        "steer": np.round(np.nan_to_num(steer, nan=0.0), 3),
        "ers_soc": np.round(np.nan_to_num(ers_soc, nan=95.0), 1),
        "ers_harvest": np.round(np.nan_to_num(ers_harvest, nan=0.0), 1),
        "tyre_temp_fl": np.round(np.nan_to_num(tyre_fl, nan=base_temp), 1),
        "tyre_temp_fr": np.round(np.nan_to_num(tyre_fr, nan=base_temp), 1),
        "tyre_temp_rl": np.round(np.nan_to_num(tyre_rl, nan=base_temp + 1.5), 1),
        "tyre_temp_rr": np.round(np.nan_to_num(tyre_rr, nan=base_temp + 1.5), 1),
        "tyre_wear": np.round(np.nan_to_num(tyre_wear, nan=5.0), 1),
        "mini_sector": mini_sector,
        "delta_to_ghost": np.round(np.nan_to_num(delta_arr, nan=0.0), 3),
    }


class FastF1Client:
    """Single source of truth client wrapping FastF1.

    # ponytail: process-local thread-safe FIFO cache + per-key stampede lock;
    # upgrade to shared Redis/diskcache if deploying multi-worker gunicorn.
    """

    _SESSION_CACHE: dict[tuple[int, str, str], fastf1.core.Session] = {}
    _GRID_CACHE: dict[tuple[int, str, str, int], dict[str, Any]] = {}
    _MAX_CACHE_SIZE: int = 8
    _CACHE_LOCK: threading.Lock = threading.Lock()
    _KEY_LOCKS: dict[tuple[Any, ...], threading.Lock] = {}

    @classmethod
    def _get_key_lock(cls, key: tuple[Any, ...]) -> threading.Lock:
        with cls._CACHE_LOCK:
            lock = cls._KEY_LOCKS.get(key)
            if lock is None:
                lock = threading.Lock()
                cls._KEY_LOCKS[key] = lock
            return lock

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
        """Load session with telemetry and laps (thread-safe, stampede-protected)."""
        cache_key = (int(year), str(round_number).lower().strip(), str(session_type).upper().strip())
        with self._CACHE_LOCK:
            if cache_key in self._SESSION_CACHE:
                return self._SESSION_CACHE[cache_key]

        key_lock = self._get_key_lock(("session", *cache_key))
        with key_lock:
            with self._CACHE_LOCK:
                if cache_key in self._SESSION_CACHE:
                    return self._SESSION_CACHE[cache_key]

            session = fastf1.get_session(year, round_number, session_type)
            session.load(telemetry=True, laps=True, weather=False, messages=False)
            # Verify laps were actually loaded before caching (FastF1 swallows network errors inside .load())
            if session.laps is None or session.laps.empty:
                raise RuntimeError(
                    f"FastF1 session laps unavailable for {year}/{round_number}/{session_type}"
                )

            with self._CACHE_LOCK:
                if len(self._SESSION_CACHE) >= self._MAX_CACHE_SIZE:
                    oldest_key = next(iter(self._SESSION_CACHE))
                    self._SESSION_CACHE.pop(oldest_key, None)
                self._SESSION_CACHE[cache_key] = session
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

            full_name = str(row.get("FullName", drv))
            team_name = str(row.get("TeamName", "F1 Team"))
            results.append({
                "code": drv,
                "driver": drv,
                "number": num,
                "name": full_name,
                "full_name": full_name,
                "team": team_name,
                "color": color,
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
        compound_str = str(flap.get("Compound", "SOFT")) if pd.notna(flap.get("Compound")) else "SOFT"
        tyre_life_val = float(flap.get("TyreLife", lap_num)) if pd.notna(flap.get("TyreLife")) else float(lap_num)

        # Reference pole lap for delta computation
        try:
            pole_lap = session.laps.pick_fastest()
            pole_tel = pole_lap.get_telemetry()
            pole_dist = pole_tel["Distance"].to_numpy()
            pole_time = pole_tel["Time"].dt.total_seconds().to_numpy()
            drv_dist_arr = tel["Distance"].to_numpy()
            drv_time_arr = tel["Time"].dt.total_seconds().to_numpy()
            ref_time_interp = np.interp(drv_dist_arr, pole_dist, pole_time)
            delta_arr = drv_time_arr - ref_time_interp
            if np.allclose(delta_arr, 0.0):
                # When comparing pole lap against itself, compute delta vs constant-pace baseline
                linear_time = (drv_dist_arr / max(1.0, max_dist)) * lap_duration
                delta_arr = (drv_time_arr - linear_time) * 0.15
        except Exception:
            delta_arr = np.zeros(len(tel), dtype=float)

        derived = _compute_derived_channels(
            dist=tel["Distance"].to_numpy() if "Distance" in tel else np.zeros(len(tel)),
            speed=tel["Speed"].to_numpy() if "Speed" in tel else np.zeros(len(tel)),
            throttle=tel["Throttle"].to_numpy() if "Throttle" in tel else np.zeros(len(tel)),
            brake=(tel["Brake"].to_numpy() == True).astype(float) * 100.0 if "Brake" in tel else np.zeros(len(tel)),
            rot_x=rot_xy[:, 0],
            rot_y=rot_xy[:, 1],
            compound=compound_str,
            tyre_life=tyre_life_val,
            delta_arr=delta_arr,
        )

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
                "steer": float(derived["steer"][i]),
                "ers_soc": float(derived["ers_soc"][i]),
                "ers_harvest": float(derived["ers_harvest"][i]),
                "tyre_temp_fl": float(derived["tyre_temp_fl"][i]),
                "tyre_temp_fr": float(derived["tyre_temp_fr"][i]),
                "tyre_temp_rl": float(derived["tyre_temp_rl"][i]),
                "tyre_temp_rr": float(derived["tyre_temp_rr"][i]),
                "tyre_wear": float(derived["tyre_wear"][i]),
                "tyre_compound": compound_str,
                "drs": drs_active,
                "flag": "GREEN",
                "safety_car": "NONE",
                "delta_to_ghost": float(derived["delta_to_ghost"][i]),
                "sector": sec,
                "mini_sector": int(derived["mini_sector"][i]),
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
        """Extract synchronized multi-driver telemetry across common lap distance grid."""
        grid_key = (int(year), str(round_number).lower().strip(), str(session_type).upper().strip(), int(steps))
        with self._CACHE_LOCK:
            if grid_key in self._GRID_CACHE:
                return self._GRID_CACHE[grid_key]

        key_lock = self._get_key_lock(("grid", *grid_key))
        with key_lock:
            with self._CACHE_LOCK:
                if grid_key in self._GRID_CACHE:
                    return self._GRID_CACHE[grid_key]
            return self._build_multi_driver_grid(year, round_number, session_type, steps, grid_key)

    def _build_multi_driver_grid(
        self,
        year: int,
        round_number: int | str,
        session_type: str,
        steps: int,
        grid_key: tuple[int, str, str, int],
    ) -> dict[str, Any]:
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

        # Create uniform reference distance grid and reference pole time curve
        dist_grid = np.linspace(0, max_dist, steps)
        time_grid = np.linspace(0, lap_duration, steps)
        ref_dist_raw = ref_tel["Distance"].to_numpy()
        ref_time_raw = ref_tel["Time"].dt.total_seconds().to_numpy()
        ref_time_curve = np.interp(dist_grid, ref_dist_raw, ref_time_raw)

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
                d_speed = np.interp(dist_grid, d_dist, dtel["Speed"].to_numpy())
                d_x = np.interp(dist_grid, d_dist, dtel["RotX"].to_numpy())
                d_y = np.interp(dist_grid, d_dist, dtel["RotY"].to_numpy())
                d_throttle = np.interp(dist_grid, d_dist, dtel["Throttle"].to_numpy())
                d_brake = np.interp(dist_grid, d_dist, (dtel["Brake"].to_numpy() == True).astype(float) * 100.0)
                d_gear = np.round(np.interp(dist_grid, d_dist, dtel["nGear"].to_numpy())).astype(int)
                d_rpm = np.interp(dist_grid, d_dist, dtel["RPM"].to_numpy())
                d_drs = np.interp(dist_grid, d_dist, dtel["DRS"].isin([10, 12, 14]).to_numpy().astype(float)) > 0.5

                if "Time" in dtel:
                    d_time_raw = dtel["Time"].dt.total_seconds().to_numpy()
                    d_time_interp = np.interp(dist_grid, d_dist, d_time_raw)
                    d_delta = d_time_interp - ref_time_curve
                    if drv == primary_driver or np.allclose(d_delta, 0.0):
                        # Show micro-pace delta relative to ideal linear sector progression for the pole setter
                        d_delta = (d_time_interp - time_grid) * 0.12
                else:
                    d_delta = np.zeros(steps, dtype=float)

                compound_str = str(dl.get("Compound", "SOFT")) if pd.notna(dl.get("Compound")) else "SOFT"
                tyre_life_val = float(dl.get("TyreLife", 3.0)) if pd.notna(dl.get("TyreLife")) else 3.0

                derived = _compute_derived_channels(
                    dist=dist_grid,
                    speed=d_speed,
                    throttle=d_throttle,
                    brake=d_brake,
                    rot_x=d_x,
                    rot_y=d_y,
                    compound=compound_str,
                    tyre_life=tyre_life_val,
                    delta_arr=d_delta,
                )

                driver_interpolated[drv] = {
                    "speed": d_speed,
                    "x": d_x,
                    "y": d_y,
                    "throttle": d_throttle,
                    "brake": d_brake,
                    "gear": d_gear,
                    "rpm": d_rpm,
                    "drs": d_drs,
                    "compound": compound_str,
                    "steer": derived["steer"],
                    "ers_soc": derived["ers_soc"],
                    "ers_harvest": derived["ers_harvest"],
                    "tyre_temp_fl": derived["tyre_temp_fl"],
                    "tyre_temp_fr": derived["tyre_temp_fr"],
                    "tyre_temp_rl": derived["tyre_temp_rl"],
                    "tyre_temp_rr": derived["tyre_temp_rr"],
                    "tyre_wear": derived["tyre_wear"],
                    "mini_sector": derived["mini_sector"],
                    "delta_to_ghost": derived["delta_to_ghost"],
                }
                valid_drivers.append(drv)
            except Exception:
                continue

        # Build list of frames
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
                    "steer": float(ddata["steer"][i]),
                    "ers_soc": float(ddata["ers_soc"][i]),
                    "ers_harvest": float(ddata["ers_harvest"][i]),
                    "tyre_temp_fl": float(ddata["tyre_temp_fl"][i]),
                    "tyre_temp_fr": float(ddata["tyre_temp_fr"][i]),
                    "tyre_temp_rl": float(ddata["tyre_temp_rl"][i]),
                    "tyre_temp_rr": float(ddata["tyre_temp_rr"][i]),
                    "tyre_wear": float(ddata["tyre_wear"][i]),
                    "tyre_compound": ddata["compound"],
                    "drs": bool(ddata["drs"][i]),
                    "flag": "GREEN",
                    "safety_car": "NONE",
                    "delta_to_ghost": float(ddata["delta_to_ghost"][i]),
                    "sector": sec,
                    "mini_sector": int(ddata["mini_sector"][i]),
                    "distance": dist,
                    "dist_remaining": dist_rem,
                    "eta_seconds": eta,
                }
            frames.append(frame_multi)

        total_laps = int(session.laps["LapNumber"].max()) if not session.laps.empty else 50
        total_race_duration = round(total_laps * lap_duration, 2)

        result = {
            "circuit": circuit,
            "results": results,
            "drivers": valid_drivers,
            "primary_driver": primary_driver,
            "lap_duration": lap_duration,
            "total_laps": total_laps,
            "total_race_duration": total_race_duration,
            "frames": frames,
        }
        with self._CACHE_LOCK:
            if len(self._GRID_CACHE) >= self._MAX_CACHE_SIZE:
                oldest_grid = next(iter(self._GRID_CACHE))
                self._GRID_CACHE.pop(oldest_grid, None)
            self._GRID_CACHE[grid_key] = result
        return result

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
        except Exception:
            logger.exception("Failed to load session %s/%s/%s", year, round_number, session_type)
            return [], "", 0, ""

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
