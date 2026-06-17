# F1 Telemetry & AI Pipeline Platform

A high-performance, full-stack telemetry visualization dashboard for Formula 1 racing. This project streams and charts real-time and historical F1 telemetry (speed, throttle, brake, gear, and RPM) using an asynchronous Python FastAPI backend, a responsive React frontend with a dark/light mode UI, and a dedicated AI agent orchestration pipeline.

---

## Overview

The **F1 Telemetry Platform** delivers a sub-millisecond latency telemetry engine. It leverages the `fastf1` library to ingest granular timing logs, process telemetry feeds through clean sanitization and validation logic, and stream live lap updates to a modern, accessible web dashboard. 

The repository features:
- **FastAPI Backend**: Serving historical REST APIs and managing persistent real-time WebSocket connections.
- **Vite & React Frontend**: Rendering optimized charts (Recharts) and KPI indicators with accessibility target spacing and a global dark theme.
- **AI Agent Pipeline (`.agents/`)**: Organizing the planner, builder, and QA skills used for automated code auditing, security scanning, and UI verification.

---

## Architecture

```
                    +-----------------------------+
                    |        FastF1 Library       |
                    +--------------+--------------+
                                   |
                                   | (Ingestion / Caching)
                                   v
                    +-----------------------------+
                    |        FastAPI Backend      |
                    |   (Historical REST APIs)    |
                    +-------+-------------+-------+
                            |             |
                 (REST API) |             | (WebSockets / ws://)
                            v             v
                    +-------+-------------+-------+
                    |        React Frontend       |
                    | (useTelemetry & useWebSocket) |
                    +--------------+--------------+
                                   |
                                   v
                    +--------------+--------------+
                    |     Interactive Dashboard   |
                    | (Recharts, Stats, Dark Mode)|
                    +-----------------------------+
```

### AI Pipeline Handoff Flow
The project is built and audited using an autonomous AI pipeline loop:
1. **Planner (`writing-plans`)**: Validates specifications and generates structural step-by-step implementations.
2. **Builder**: Writes optimized, modular React hooks, API handlers, and design system styling.
3. **QA Loop (`ui-ux-pro-max`)**: Enforces touch target accessibility standards (>=44px), rendering benchmarks, and cleans up component re-renders.
4. **Security Pass (`SecureCoder`)**: Detects XSS vectors, sanitizes session select inputs, rejects raw binary sockets, and manages race condition request flags.

---

## Project Structure

```
f1-telemetry/
├── .agents/                    # AI agent pipeline logs, prompts, and custom skills
├── backend/                    # FastAPI python backend application
│   ├── api/
│   │   ├── routes.py           # REST endpoints (/sessions, /telemetry, /telemetry/metadata)
│   │   └── websocket.py        # WebSocket server routes and handler loops
│   ├── ingestion/
│   │   └── fastf1_client.py    # FastF1 client wrapping data loads and cache management
│   ├── models/
│   │   └── schemas.py          # Pydantic validation schemas
│   ├── services/
│   │   ├── telemetry_store.py  # Thread-safe in-memory data store with asyncio.Lock
│   │   └── ws_manager.py       # Client websocket subscription and dispatch manager
│   └── main.py                 # FastAPI application initialization & security middleware
├── frontend/                   # React frontend application
│   ├── src/
│   │   ├── components/         # Reusable UI widgets (Header, ConnectionStatus, StatsCard, etc.)
│   │   ├── context/            # Global theme context (Dark/Light mode)
│   │   ├── hooks/              # Custom data hooks (useTelemetry, useWebSocket, useTheme)
│   │   ├── pages/              # Responsive Dashboard layouts and styling
│   │   ├── services/           # REST API client wrapper using standard fetch
│   │   ├── App.jsx             # React entry point with Theme providers
│   │   └── main.jsx            # React virtual DOM mount
│   ├── package.json            # Frontend NPM package requirements
│   ├── vite.config.js          # Vite config with dev-server proxy definitions
│   └── index.html              # HTML shell with viewport and font link definitions
├── requirements.txt             # Python backend dependencies
└── README.md                    # Project documentation
```

---

## How It Works

1. **System Startup**: The FastAPI backend is launched and initiates singletons for the telemetry store, connection managers, and local cache.
2. **REST Loading**: The React dashboard requests ingested sessions from `/api/v1/sessions`. When a session is selected, `useTelemetry` loads the historical points via `/api/v1/telemetry`.
3. **WebSocket Connection**: The frontend establishes a WebSocket connection to `ws://localhost:8000/ws/telemetry`. The client registers dynamic filters (e.g. current year, round, session type) by broadcasting filtering updates back to the backend.
4. **Data Normalization & Streaming**: Telemetry updates stream to the frontend in JSON format. The custom hook `useWebSocket` validates length constraints and message payloads, feeding validated telemetry data into `useTelemetry`'s rolling buffer.
5. **UI Rendering**: The React frontend uses downsampled buffers and `useMemo` states to feed charts efficiently. It disables animations during active streaming and memoizes elements (`StatsCard`, `GearIndicator`) to minimize garbage collection cycles.

---

## Tech Stack

### Backend
- **Python 3.9+**
- **FastAPI** / **Uvicorn** (Asynchronous REST & WebSocket routing)
- **FastF1** (Telemetry parsing engine)
- **Pandas** & **NumPy** (Data cleaning & serialization)
- **Pydantic v2** (Strict schema validation)

### Frontend
- **React 18+** & **Vite** (Build toolchain)
- **Recharts** (Performant Canvas/SVG data visualization)
- **Vanilla CSS Custom Properties** (Sleek light & dark variables)
- **Lucide Icons / SVG** (Crisp vector graphics with no external layout jitter)

---

## Features

- **Real-Time Telemetry Streaming**: High-frequency telemetry updates distributed seamlessly over WebSockets.
- **Deduplicated Request Loading**: Stale or slow REST queries are automatically discarded when switching session dropdowns, preventing concurrent UI updates.
- **Accessible Design Target Sizing**: Interactive touch areas (dropdowns, theme controls, dismiss actions) strictly respect the `>= 44px` mobile specification guidelines.
- **Robust Input Sanitization**: Deep validation parameters on both backend (FastAPI Pydantic) and frontend (regex checks, JSON size limits, alphanumeric filtering) prevent injection attacks.
- **Dynamic CSS variables**: Light and Dark mode variables support smooth, flickerless switching.

---

## Getting Started

### Backend Setup

1. Navigate to the backend directory and set up a virtual environment:
   ```bash
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Install python packages:
   ```bash
   pip install -r ../requirements.txt
   ```
3. Start the FastAPI development server:
   ```bash
   uvicorn main:app --host 127.0.0.1 --port 8000 --reload
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   npm install
   ```
2. Start the Vite hot-reloading development server:
   ```bash
   npm run dev
   ```
3. Open your browser and navigate to [http://localhost:3000](http://localhost:3000). The dev-server automatically proxies REST and WebSocket traffic to the FastAPI backend.

---

## Future Improvements

- **Database Persistence**: Swap the transient in-memory store for a high-performance database instance (such as TimescaleDB or Redis).
- **Authentication**: Set up JWT authentication guards for WebSocket handshakes and stateful REST actions.
- **Live timing feed**: Adapt the FastF1Client connection layer to stream directly from active Formula 1 live timing feeds during race weekends.

---

## Contributing

1. Fork the project.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'feat: add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

## License

This project is licensed under the MIT License.

---

## Key Insight / Summary

The **F1 Telemetry Platform** combines high-frequency async networking with a streamlined React UI to visualize motorsport metrics. Engineered with strict design guidelines, performance constraints, and secure boundaries, the application offers an accessible, production-ready foundation for professional telemetry analysis.