import pytest
from fastapi.testclient import TestClient
from backend.main import app

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_list_circuits(client):
    response = client.get("/api/v1/circuits")
    assert response.status_code == 200
    circuits = response.json()
    assert isinstance(circuits, list)
    assert len(circuits) >= 6
    circuit_ids = [c["id"] for c in circuits]
    assert "bahrain" in circuit_ids
    assert "monaco" in circuit_ids
    assert "silverstone" in circuit_ids
    assert "monza" in circuit_ids
    assert "spa" in circuit_ids

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

def test_multi_driver_telemetry_query(client):
    response = client.get("/api/v1/telemetry?year=2024&round=1&session_type=Q&drivers=VER,NOR,LEC")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "drivers_data" in data
    assert "VER" in data["drivers_data"]
    assert "NOR" in data["drivers_data"]
    assert "LEC" in data["drivers_data"]
    assert len(data["drivers_data"]["VER"]) > 0
    assert len(data["drivers_data"]["NOR"]) > 0
    assert data["circuit_id"] == "bahrain"
