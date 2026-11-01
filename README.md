# Apex Pitwall — F1 Telemetry & Race Control Platform

A production-grade Formula 1 telemetry broadcast, multi-driver analysis, and race engineering platform powered by **FastAPI**, **FastF1**, and **React 18 + HTML5 HiDPI Canvas**.

---

## Overview

**Apex Pitwall** ingests official FIA/FastF1 championship telemetry and streams synchronized 20-car telemetry frames over WebSockets (`20 Hz` stream interpolated at `60 FPS` on the client). It combines an authentic pit-wall engineering workspace with interactive telemetry inspection and applied motorsport physics visualizations.

### Key Capabilities
- **20-Driver Live Timing Tower**: Dynamic race/qualifying leaderboard sorted in real time with **GAP** (to leader) and **INT** (to car ahead) modes, tyre compound badges, active DRS indicators, and up to 4 simultaneous comparison drivers.
- **HiDPI GPS Circuit Map (`TrackMapCanvas`)**: Retina-scaled 2D circuit trace with unified sector color coding (`S1` Cyan, `S2` Amber, `S3` Purple), DRS zones, turn markers, non-overlapping driver callout badges, and synchronized hover target markers.
- **4-Channel 60 FPS Telemetry Oscilloscope (`TelemetryCanvas`)**: Multi-driver overlay plotting Speed (`0–350 km/h`), Throttle/Brake (`0–100%`), Signed Steering Curvature & Pole Delta (`s`), and Engine RPM/Gearbox (`0–13,500 RPM`) with interactive mouse/touch crosshair inspection.
- **Derived Physics & Thermal Channels**: Computes signed lateral path curvature (`steer`), MGU-K kinetic regeneration (`ers_harvest`), cumulative battery state of charge (`ers_soc`), 4-corner tyre surface temperatures (`tyre_temp_fl/fr/rl/rr`), tyre degradation (`tyre_wear`), and pole-reference time deltas (`delta_to_ghost`) from FastF1 telemetry.
- **Pit-Wall Cockpit HUD (`PitWallHUD`)**: 15-LED shift light array, multi-car duel delta table, 4-corner tyre thermal diagram, hybrid ERS deployment/regen bar, and live sector split status (`PURPLE` / `GREEN` / `YELLOW`).
- **STEM Engineering & Physics Panel (`StemPhysicsPanel`)**: Interactive engineering exhibit with live SVG diagrams for Aerodynamic Downforce ($F_z$ vs. $798\text{ kg}$ car mass), MGU-K Hybrid Power Flow, and a 2D G-G Friction Circle (Kamm's Circle).
- **Custom FastF1 Session Loader & Lap Stepper**: Switch between preset Grand Prix sessions or load any custom FastF1 season (`2021–2024`), round (`1–24`), and session type (`R`, `Q`, `S`, `FP1`), plus instant lap-by-lap stepping and keyboard shortcuts (`Space`, `←`/`→`, `↑`/`↓`, `1`–`4`).
- **Accessible Dark & Light Themes**: Semantic design tokens engineered for $\ge 4.5:1$ contrast across both Dark and Daylight Pit-Wall modes.

---

## Architecture

```
+-------------------------------------------------------------------+
|                        FastF1 + SQLite Cache                      |
|         (20-Driver Grid Telemetry + Derived Physics Engine)       |
+---------------------------------+---------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|                      FastAPI Backend (Port 8000)                  |
|  - REST API (/api/v1/sessions, /circuits, /telemetry, /metadata)  |
|  - Async ReplayEngine + WebSocket Stream (/ws/telemetry @ 20Hz)   |
|  - Non-blocking asyncio.to_thread FastF1 Loader & FIFO Cache      |
+-----------------+-------------------------------+-----------------+
                  | (REST JSON)                   | (WebSocket 20Hz)
                  v                               v
+-------------------------------------------------------------------+
|                   React 18 + Vite Frontend (Port 3000)            |
|  - useTelemetry & useWebSocket (Auto-Reconnect + Rolling Buffers) |
|  - HiDPI TrackMapCanvas (60 FPS Lerp + Collision-Free Badges)     |
|  - HiDPI TelemetryCanvas (4-Channel Oscilloscope + Crosshair)     |
|  - TimingTower + PitWallHUD + StemPhysicsPanel                    |
+-------------------------------------------------------------------+
```

---

## Project Structure

```text
f1-telemetry/
├── backend/
│   ├── api/
│   │   ├── dependencies.py         # FastAPI dependency injection providers
│   │   ├── routes.py               # REST endpoints (/api/v1/*)
│   │   └── websocket.py            # Real-time 20Hz WebSocket replay endpoint (/ws/telemetry)
│   ├── ingestion/
│   │   ├── fastf1_client.py        # FastF1 session loader, derived physics & LRU cache
│   │   └── scheduler.py            # Optional background ingestion scheduler
│   ├── models/
│   │   └── schemas.py              # Pydantic v2 request/response & stream schemas
│   ├── services/
│   │   ├── circuit_store.py        # Official circuit coordinate & turn registry
│   │   ├── circuits_official.json  # Pre-extracted GPS circuit geometries
│   │   ├── processing.py           # Telemetry sanitization & unit normalization
│   │   ├── replay.py               # Continuous multi-driver replay & interpolation engine
│   │   ├── telemetry_store.py      # Async-safe in-memory telemetry store
│   │   └── ws_manager.py           # WebSocket connection manager
│   ├── tests/
│   │   └── test_multi_driver_routes.py # Pytest unit, REST, and WebSocket test suite
│   ├── config.py                   # Environment-driven Pydantic Settings (F1_*)
│   └── main.py                     # FastAPI app factory, lifespan, CORS & security headers
├── frontend/
│   ├── src/
│   │   ├── components/             # Header, TimingTower, TrackMapCanvas, PitWallHUD, TelemetryCanvas, StemPhysicsPanel
│   │   ├── context/                # ThemeContext (Dark/Light mode persistence)
│   │   ├── hooks/                  # useTelemetry, useWebSocket, useTheme
│   │   ├── pages/                  # Dashboard workspace layout & playback toolbar
│   │   ├── services/               # REST API client & driver/circuit metadata
│   │   ├── App.jsx                 # Root application shell
│   │   ├── index.css               # Global design tokens (Dark & Light themes)
│   │   └── main.jsx                # React DOM entry point
│   ├── package.json                # Minimal frontend dependencies (react, react-dom, vite)
│   └── vite.config.js              # Vite dev & preview server with API/WS proxy
├── Dockerfile                      # Multi-stage Dockerfile (dev & prod targets)
├── compose.yaml                    # Base Docker Compose service & network definitions
├── compose.override.yaml           # Development overrides (hot reload & source bind mounts)
├── compose.prod.yaml               # Production overrides (non-root, built assets, restart policy)
├── .dockerignore                   # Docker build context exclusions
├── .env.example                    # Example environment configuration
├── requirements.txt                # Python backend dependencies
└── README.md                       # Project & Docker documentation
```

---

## Docker Workflows (Recommended)

The project uses a clean multi-stage `Dockerfile` and separated Compose configuration for **Development** and **Production**.

### 1. Development Mode (Hot Reload + Source Mounts)
`docker compose up --build` automatically merges `compose.yaml` and `compose.override.yaml`:
- Mounts `./backend` and `./frontend/src` for live code reloading (`uvicorn --reload` and Vite HMR).
- Preserves container `node_modules` and mounts `./.fastf1_cache` for instant access to cached FIA sessions.

```bash
# Start development stack in foreground
docker compose up --build

# Or start in detached mode
docker compose up --build -d

# View logs
docker compose logs -f

# Stop development stack
docker compose down
```

### 2. Production Mode (Hardened Non-Root Multi-Stage Build)
`compose.prod.yaml` layers production settings onto `compose.yaml` without `compose.override.yaml`:
- Compiles static frontend assets (`npm run build`) during image build.
- Runs both backend (`appuser`, UID 1000) and frontend (`node`, UID 1000) as non-root users.
- Mounts no source code directories and configures `restart: unless-stopped` with container healthchecks.

```bash
# Build and start production containers in detached mode
docker compose -f compose.yaml -f compose.prod.yaml up --build -d

# Check container health status
docker compose -f compose.yaml -f compose.prod.yaml ps

# View production logs
docker compose -f compose.yaml -f compose.prod.yaml logs -f

# Stop production stack
docker compose -f compose.yaml -f compose.prod.yaml down
```

### Local Access URLs
- **Web Dashboard UI**: `http://localhost:3000`
- **Backend REST API Base**: `http://localhost:8000/api/v1` (also proxied at `http://localhost:3000/api/v1`)
- **Interactive OpenAPI Docs**: `http://localhost:8000/docs`
- **Health Check Endpoint**: `http://localhost:8000/health` (and `http://localhost:3000/health`)
- **WebSocket Stream**: `ws://localhost:8000/ws/telemetry` (and `ws://localhost:3000/ws/telemetry`)

---

## Local Bare-Metal Setup (Without Docker)

### 1. Backend
```bash
# From f1-telemetry/ root
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000` in your browser.

---

## Environment Variables

Copy `.env.example` to `.env` to customize settings:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `F1_APP_TITLE` | `F1 Telemetry Platform` | FastAPI application title |
| `F1_LOG_LEVEL` | `INFO` (`DEBUG` in dev) | Python logging level |
| `F1_ALLOWED_ORIGINS` | `["http://localhost:3000","http://127.0.0.1:3000"]` | CORS allowed origins |
| `F1_FASTF1_CACHE_DIR` | `.fastf1_cache` | Directory for FastF1 SQLite & HTTP cache |
| `F1_ENABLE_SCHEDULED_INGESTION` | `false` | Enable periodic background session ingestion |
| `FRONTEND_PORT` | `3000` | Host port mapped to the frontend service |
| `BACKEND_PORT` | `8000` | Host port mapped to the backend service |

---

## Testing & Verification

```bash
# 1. Run backend unit, REST, and WebSocket test suite
PYTHONPATH=. pytest -v

# 2. Build frontend production bundle
cd frontend && npm run build

# 3. Run end-to-end REST + WebSocket integration script (via frontend proxy on :3000)
python3 backend/run_integration.py
```

---

## Troubleshooting

- **First-time uncached Grand Prix session takes 10–20 seconds to load**:
  Preset sessions (`2023` Bahrain, Monaco, Silverstone, Spa, Monza and `2024` Bahrain) are pre-cached in `.fastf1_cache/` and load rapidly. Loading a new custom round downloads telemetry from the official F1 timing archive and caches it in `.fastf1_cache/` for subsequent runs.
- **Port `3000` or `8000` already in use**:
  Override `FRONTEND_PORT` or `BACKEND_PORT` in `.env` or inline:
  `FRONTEND_PORT=3001 BACKEND_PORT=8001 docker compose up --build -d`
- **Permission denied on `.fastf1_cache`**:
  Ensure `.fastf1_cache` is owned by UID `1000` (`chown -R 1000:1000 .fastf1_cache`).
