from __future__ import annotations

import concurrent.futures
import math
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.ingestion.fastf1_client import FastF1Client, _compute_derived_channels
from backend.main import app
from backend.services.processing import _normalize_timestamp, _safe_float, _safe_int, process_raw_batch
from backend.services.replay import ReplayEngine


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_list_circuits(client):
    response = client.get("/api/v1/circuits")
    assert response.status_code == 200
    circuits = response.json()
    assert isinstance(circuits, list)
    assert len(circuits) >= 6
    circuit_ids = [c["id"] for c in circuits]
    for expected in ("bahrain", "monaco", "silverstone", "monza", "spa"):
        assert expected in circuit_ids


def test_get_circuit_details(client):
    response = client.get("/api/v1/circuits/monaco")
    assert response.status_code == 200
    circuit = response.json()
    assert circuit["id"] == "monaco"
    assert "waypoints" in circuit
    assert len(circuit["waypoints"]) > 10
    assert "turns" in circuit
    assert "drs_zones" in circuit


def test_list_sessions_has_multiple_events(client):
    response = client.get("/api/v1/sessions")
    assert response.status_code == 200
    sessions = response.json()
    assert isinstance(sessions, list)
    assert len(sessions) >= 5
    events = [s["event_name"] for s in sessions]
    assert any("Bahrain" in ev for ev in events)
    assert any("Monaco" in ev for ev in events)


def test_telemetry_metadata_includes_derived_channels(client):
    response = client.get("/api/v1/telemetry/metadata")
    assert response.status_code == 200
    fields = {f["name"] for f in response.json()}
    for expected in (
        "timestamp",
        "lap",
        "speed",
        "throttle",
        "brake",
        "gear",
        "rpm",
        "steer",
        "ers_soc",
        "ers_harvest",
        "tyre_temp_fl",
        "tyre_temp_fr",
        "tyre_temp_rl",
        "tyre_temp_rr",
        "tyre_wear",
        "delta_to_ghost",
        "distance",
        "drs",
    ):
        assert expected in fields


def test_multi_driver_telemetry_query_and_derived_bounds(client):
    response = client.get("/api/v1/telemetry?year=2024&round=1&session_type=Q&drivers=VER,NOR,LEC")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "drivers_data" in data
    assert "VER" in data["drivers_data"]
    assert "NOR" in data["drivers_data"]
    assert "LEC" in data["drivers_data"]

    ver_pts = data["drivers_data"]["VER"]
    nor_pts = data["drivers_data"]["NOR"]
    assert len(ver_pts) > 50
    assert len(nor_pts) > 50
    assert data["circuit_id"] == "bahrain"

    # Validate numerical ranges, finite values, and non-static variation across all derived channels
    for pt in ver_pts:
        assert isinstance(pt["steer"], float) and -1.0 <= pt["steer"] <= 1.0
        assert isinstance(pt["ers_soc"], float) and 18.0 <= pt["ers_soc"] <= 100.0
        assert isinstance(pt["ers_harvest"], float) and 0.0 <= pt["ers_harvest"] <= 120.0
        for tk in ("tyre_temp_fl", "tyre_temp_fr", "tyre_temp_rl", "tyre_temp_rr"):
            assert isinstance(pt[tk], float) and 40.0 <= pt[tk] <= 160.0
        assert isinstance(pt["tyre_wear"], float) and 0.0 <= pt["tyre_wear"] <= 100.0
        assert isinstance(pt["mini_sector"], int) and 1 <= pt["mini_sector"] <= 25
        assert isinstance(pt["delta_to_ghost"], float) and math.isfinite(pt["delta_to_ghost"])

    assert len({pt["steer"] for pt in ver_pts}) > 5
    assert len({pt["ers_soc"] for pt in ver_pts}) > 5
    assert len({pt["ers_harvest"] for pt in ver_pts}) > 3
    assert len({pt["tyre_temp_fl"] for pt in ver_pts}) > 5
    assert len({pt["mini_sector"] for pt in ver_pts}) >= 20

    # Check both negative and positive delta values across pole setter micro-sectors or comparison driver
    all_deltas = [pt["delta_to_ghost"] for pt in ver_pts] + [pt["delta_to_ghost"] for pt in nor_pts]
    assert any(d < 0 for d in all_deltas), "Expected negative delta segments"
    assert any(d > 0 for d in all_deltas), "Expected positive delta segments"


def test_derived_channels_edge_cases_nan_inf_stationary():
    # 1. Empty array
    assert _compute_derived_channels(
        np.array([]), np.array([]), np.array([]), np.array([]), np.array([]), np.array([])
    ) == {}

    # 2. Stationary zero-distance & NaN / Inf values
    dist = np.array([0.0, 0.0, float("nan"), float("inf"), 0.0, 0.0])
    speed = np.array([0.0, float("nan"), float("inf"), -10.0, 0.0, 0.0])
    throttle = np.array([0.0, float("nan"), 150.0, -5.0, 0.0, 0.0])
    brake = np.array([0.0, float("inf"), 0.0, 100.0, 0.0, 0.0])
    rx = np.array([0.0, 0.0, float("nan"), 0.0, 0.0, 0.0])
    ry = np.array([0.0, 0.0, 0.0, float("-inf"), 0.0, 0.0])

    derived = _compute_derived_channels(
        dist=dist,
        speed=speed,
        throttle=throttle,
        brake=brake,
        rot_x=rx,
        rot_y=ry,
        compound="HARD",
        tyre_life=1.0,
        delta_arr=np.array([float("nan"), -0.25, 0.0, 0.42, float("inf"), -0.1]),
    )
    for key, arr in derived.items():
        assert len(arr) == 6, f"Channel {key} length mismatch"
        assert np.all(np.isfinite(arr)), f"Channel {key} contains non-finite values"
    assert np.all((derived["ers_soc"] >= 18.0) & (derived["ers_soc"] <= 100.0))
    assert np.all((derived["ers_harvest"] >= 0.0) & (derived["ers_harvest"] <= 120.0))
    assert np.all((derived["tyre_wear"] >= 0.0) & (derived["tyre_wear"] <= 100.0))


def test_processing_nan_inf_and_missing_channels():
    assert _safe_float(float("nan"), 12.5) == 12.5
    assert _safe_float(float("inf"), 7.0) == 7.0
    assert _safe_int(float("nan"), 3) == 3

    with pytest.raises(ValueError):
        _normalize_timestamp(float("nan"))
    with pytest.raises(ValueError):
        _normalize_timestamp(-1.5)

    batch = process_raw_batch([
        {"timestamp": 1.0, "speed": 210.0, "steer": float("nan"), "ers_soc": 92.5},
        {"timestamp": None, "speed": 100.0},  # invalid timestamp -> dropped
        "not_a_dict",  # invalid -> dropped
    ])
    assert len(batch) == 1
    assert batch[0].speed == 210.0
    assert batch[0].steer == 0.0
    assert batch[0].ers_soc == 92.5


def test_websocket_full_controls_and_replay_synchronization(client):
    with client.websocket_connect("/ws/telemetry?year=2023&round=1&session_type=Q&driver=VER") as ws:
        # 1. Initial session_metadata
        meta = ws.receive_json()
        assert meta["type"] == "session_metadata"
        assert meta["total_laps"] >= 1
        assert isinstance(meta["driver_results"], list)
        assert len(meta["driver_results"]) > 0
        assert "code" in meta["driver_results"][0]

        # 2. Pause playback
        ws.send_json({"type": "pause"})
        for _ in range(20):
            msg = ws.receive_json()
            if msg["type"] == "playback_status":
                assert msg["isPlaying"] is False
                break
        else:
            pytest.fail("Did not receive pause playback_status")

        # 3. Seek forward while paused -> immediate telemetry_update at target timestamp
        ws.send_json({"type": "seek", "timestamp": 42.5})
        for _ in range(10):
            msg = ws.receive_json()
            if msg["type"] == "telemetry_update":
                assert abs(msg["race_time"] - 42.5) < 0.2
                break
        else:
            pytest.fail("Did not receive telemetry_update after forward seek")

        # 4. Seek backward while paused
        ws.send_json({"type": "seek", "timestamp": 10.0})
        for _ in range(10):
            msg = ws.receive_json()
            if msg["type"] == "telemetry_update":
                assert abs(msg["race_time"] - 10.0) < 0.2
                break
        else:
            pytest.fail("Did not receive telemetry_update after backward seek")

        # 5. Seek to lap 3 -> verify lap offset & tyre wear reset behavior
        ws.send_json({"type": "seek_lap", "lap": 3})
        for _ in range(10):
            msg = ws.receive_json()
            if msg["type"] == "telemetry_update":
                assert msg["current_lap"] == 3
                ver_wear_lap3 = msg["multi_payload"]["VER"]["tyre_wear"]
                break
        else:
            pytest.fail("Did not receive telemetry_update after seek_lap 3")

        ws.send_json({"type": "seek_lap", "lap": 1})
        for _ in range(10):
            msg = ws.receive_json()
            if msg["type"] == "telemetry_update":
                assert msg["current_lap"] == 1
                ver_wear_lap1 = msg["multi_payload"]["VER"]["tyre_wear"]
                assert ver_wear_lap1 < ver_wear_lap3
                break

        # 6. Set playback speed
        ws.send_json({"type": "set_speed", "speed": 5.0})
        for _ in range(10):
            msg = ws.receive_json()
            if msg["type"] == "speed_status":
                assert msg["speed"] == 5.0
                break
        else:
            pytest.fail("Did not receive speed_status")

        # 7. Ping / Pong
        ws.send_json({"type": "ping"})
        for _ in range(10):
            msg = ws.receive_json()
            if msg["type"] == "pong":
                break
        else:
            pytest.fail("Did not receive pong")

        # 8. Filters update
        ws.send_json({"year": 2023, "round": 1, "session_type": "Q", "driver": "LEC"})
        for _ in range(10):
            msg = ws.receive_json()
            if msg["type"] == "filters_updated":
                assert msg["filters"]["driver"] == "LEC"
                break
        else:
            pytest.fail("Did not receive filters_updated")

        # 9. Switch race -> loading_status -> race_switched -> telemetry_update
        ws.send_json({"type": "switch_race", "year": 2023, "round": 12, "session_type": "R", "circuit_id": "spa"})
        got_loading = False
        got_switched = False
        for _ in range(20):
            msg = ws.receive_json()
            if msg["type"] == "loading_status" and msg.get("loading") is True:
                got_loading = True
            elif msg["type"] == "race_switched":
                got_switched = True
                assert msg["round"] == 12
                assert msg["loading"] is False
                break
        assert got_loading and got_switched


def test_concurrent_websocket_client_isolation(client):
    with client.websocket_connect("/ws/telemetry?year=2023&round=1&session_type=Q&driver=VER") as ws1, \
         client.websocket_connect("/ws/telemetry?year=2023&round=12&session_type=R&driver=LEC") as ws2:
        m1 = ws1.receive_json()
        m2 = ws2.receive_json()
        assert m1["type"] == "session_metadata" and m1["round"] == 1
        assert m2["type"] == "session_metadata" and m2["round"] == 12

        # Pause and seek ws1; verify ws2 remains independent on round 12
        ws1.send_json({"type": "pause"})
        ws1.send_json({"type": "seek", "timestamp": 55.0})
        ws2.send_json({"type": "seek_lap", "lap": 5})

        for _ in range(15):
            msg2 = ws2.receive_json()
            if msg2["type"] == "telemetry_update" and msg2["current_lap"] == 5:
                assert msg2["round"] == 12
                break
        else:
            pytest.fail("Client 2 did not independently advance to lap 5 on round 12")


def test_fastf1_cache_thread_safety_and_eviction():
    f1_client = FastF1Client()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [
            pool.submit(f1_client.fetch_multi_driver_grid_telemetry, 2023, 1, "Q")
            for _ in range(4)
        ]
        results = [f.result() for f in futures]
    assert all(r is results[0] for r in results), "Concurrent callers should share the cached grid object"
