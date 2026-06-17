import asyncio
import json
import requests
import websockets

FRONTEND_REST_URL = "http://127.0.0.1:3000"
FRONTEND_WS_URL = "ws://127.0.0.1:3000/ws/telemetry"

def test_rest_endpoints():
    print("=== Testing REST API via Vite Proxy ===")
    
    # 1. Test Health
    health_url = f"{FRONTEND_REST_URL}/health"
    print(f"GET {health_url} ...")
    r = requests.get(health_url)
    print(f"Status: {r.status_code}, Body: {r.json()}")
    assert r.status_code == 200, "Health check failed"
    assert r.json().get("status") == "ok", "Expected status 'ok'"
    
    # 2. Test Sessions
    sessions_url = f"{FRONTEND_REST_URL}/api/v1/sessions"
    print(f"GET {sessions_url} ...")
    r = requests.get(sessions_url)
    sessions = r.json()
    print(f"Status: {r.status_code}, Ingested Sessions Count: {len(sessions)}")
    assert r.status_code == 200, "Sessions fetch failed"
    assert len(sessions) >= 1, "Expected at least the pre-populated example session"
    
    # 3. Test Metadata
    metadata_url = f"{FRONTEND_REST_URL}/api/v1/telemetry/metadata"
    print(f"GET {metadata_url} ...")
    r = requests.get(metadata_url)
    print(f"Status: {r.status_code}, Metadata Fields: {len(r.json())}")
    assert r.status_code == 200, "Metadata fetch failed"
    
    # 4. Test Telemetry Query (for pre-populated Bahrain session)
    telemetry_url = f"{FRONTEND_REST_URL}/api/v1/telemetry?year=2023&round=1&session_type=Q"
    print(f"GET {telemetry_url} ...")
    r = requests.get(telemetry_url)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, "Telemetry query failed"
    data = r.json()
    assert "data" in data, "Expected 'data' key in response"
    assert "summary" in data, "Expected 'summary' key in response"
    print(f"Ingested points count: {len(data['data'])}")
    print(f"Stats summary: {data['summary']}")
    
    # 5. Test Multi-Race/Driver parameters: GET /telemetry?year=2023&race=Monaco&session=Q&driver=VER
    multi_race_url = f"{FRONTEND_REST_URL}/api/v1/telemetry?year=2023&race=Monaco&session=Q&driver=VER"
    print(f"GET {multi_race_url} ...")
    r = requests.get(multi_race_url)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, "Multi-race telemetry query failed"
    data_multi = r.json()
    assert "data" in data_multi, "Expected 'data' key in response"
    assert "summary" in data_multi, "Expected 'summary' key in response"
    assert len(data_multi["data"]) > 0, "Expected fallback data or live telemetry points"
    print(f"Multi-race/Driver points count: {len(data_multi['data'])}")
    
    print("REST tests passed successfully!\n")

async def test_websocket_endpoint():
    print("=== Testing WebSocket API via Vite Proxy ===")
    print(f"Connecting to {FRONTEND_WS_URL} ...")
    
    async with websockets.connect(FRONTEND_WS_URL) as ws:
        print("WebSocket handshake succeeded.")
        
        # Send heartbeat ping
        ping_msg = {"type": "ping"}
        print(f"Sending: {ping_msg}")
        await ws.send(json.dumps(ping_msg))
        
        # Wait for pong response
        response = await ws.recv()
        data = json.loads(response)
        print(f"Received: {data}")
        assert data.get("type") == "pong", "Expected type 'pong'"
        
        # Send filter subscription update including driver filter
        sub_msg = {
            "year": 2023,
            "round": 1,
            "session_type": "Q",
            "driver": "VER"
        }
        print(f"Sending filter update: {sub_msg}")
        await ws.send(json.dumps(sub_msg))
        
        # Wait for filter update confirmation
        response = await ws.recv()
        data = json.loads(response)
        print(f"Received: {data}")
        assert data.get("type") == "filters_updated", "Expected filters_updated confirmation"
        
        print("WebSocket tests passed successfully!\n")

def main():
    test_rest_endpoints()
    asyncio.run(test_websocket_endpoint())
    print("All integration tests PASSED successfully!")

if __name__ == "__main__":
    main()
