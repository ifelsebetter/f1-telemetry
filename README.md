# F1 Telemetry Platform

## Overview
The **F1 Telemetry Platform** is a high-performance, asynchronous FastAPI backend designed to process, store, and stream Formula 1 telemetry data. By wrapping the `fastf1` library, the platform ingests rich session data—including speed, throttle, brake, gear, and engine RPM—and exposes it via REST APIs and real-time WebSocket connections. The system features validation schemas, local file caching to prevent API rate limits, and a thread-safe in-memory store engineered to be easily swappable with production-grade datastores.

---

## Architecture

The system operates across four primary layers:
1. **Ingestion Layer**: Pulls data from the FastF1 library. Ingested raw telemetry data is cached locally to speed up subsequent requests. A task scheduler can optionally trigger periodic updates.
2. **Processing Pipeline**: Standardizes timestamps, normalizes telemetry fields, filters out malformed payloads, and converts data into validated Pydantic data models.
3. **Storage Layer**: A thread-safe, in-memory repository protected by an asynchronous lock to prevent concurrent write collisions.
4. **API and WebSocket Layer**: Exposes endpoints for client queries, manages real-time socket subscriptions, handles heartbeats (ping/pong), and routes targeted live updates to subscribers.

```
                                +-------------------+
                                |   FastF1 Library  |
                                +---------+---------+
                                          |
                                          | (Downloads telemetry & cache files)
                                          v
                                +---------+---------+
                                |    FastF1Client   |
                                +---------+---------+
                                          |
                                          | (Extracts raw record dicts)
                                          v
                                +---------+---------+
                                | Processing Pipe  |
                                +----+----------+---+
                                     |          |
                    (Saves sessions) |          | (Broadcasts active data)
                                     v          v
                             +-------+---+  +---+-------+
                             | Telemetry |  |  Conn.    |
                             |   Store   |  |  Manager  |
                             +-------+---+  +---+-------+
                                     ^          ^
                                     |          |
                                (REST API)  (WebSockets)
                                     |          |
                                     v          v
                                +----+----------+---+
                                |      FastAPI      |
                                +---------+---------+
                                          ^
                                          | (HTTP & WS connections)
                                          v
                                +---------+---------+
                                |  Client / UI App  |
                                +-------------------+
```

---

## Project Structure

```
f1-telemetry/
├── backend/
│   ├── api/
│   │   ├── __init__.py
│   │   ├── dependencies.py      # Dependency injection factories (store, client, WS manager)
│   │   ├── routes.py            # REST API endpoints (/sessions, /telemetry, /telemetry/metadata)
│   │   └── websocket.py         # WebSocket route handler and client filter loops
│   ├── ingestion/
│   │   ├── __init__.py
│   │   ├── fastf1_client.py     # FastF1 client wrapping session loads and schedule lists
│   │   └── scheduler.py         # Ingestion scheduler using APScheduler AsyncIOScheduler
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py           # Pydantic data structures and validation schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── processing.py        # Telemetry ingestion, cleansing, and broadcast pipeline
│   │   ├── telemetry_store.py   # Thread-safe in-memory store utilizing asyncio.Lock
│   │   └── ws_manager.py        # Connection manager with filter-matching capabilities
│   ├── config.py                # Environment configuration using pydantic-settings
│   ├── main.py                  # Main application entry point, middleware, and CORS configuration
│   └── __init__.py
├── requirements.txt             # Python application dependencies
└── README.md                    # Project documentation
```

---

## How It Works

1. **Service Initialization**: On startup, the FastAPI app setup initializes the singletons for the `TelemetryStore`, `ConnectionManager`, and `FastF1Client` within the application lifespan. The ingestion scheduler is triggered if enabled.
2. **On-Demand Data Fetching**: When a user queries historical telemetry for a season and round that is not yet loaded, the system automatically calls `FastF1Client` to fetch, extract, and cache the session's data from the FastF1 backend.
3. **Data Processing Pipeline**: The raw records are parsed, timestamps are converted into seconds, numeric fields are coerced safely, and Pydantic parses them into the strict `TelemetryData` schema.
4. **Concurrency-Safe Storage**: Processed data is saved inside the lock-protected `TelemetryStore`. This ensures that even under heavy API traffic, writes do not interfere with concurrent reads.
5. **Real-Time Distribution**: The connection manager tracks active WebSocket clients. As raw telemetry batches are ingested, the system broadcasts the latest records to subscribers whose registered subscription filters (such as `lap` numbers) match the incoming data.

---

## Tech Stack

* **Language**: Python 3.8+
* **Backend Framework**: FastAPI (>=0.111.0)
* **Web Server**: Uvicorn (>=0.30.0)
* **Data Sources**: FastF1 (>=3.3.0)
* **Data Manipulation**: Pandas (>=2.2.0), NumPy (>=1.26.0)
* **Validation & Configuration**: Pydantic (>=2.7.0), Pydantic Settings (>=2.3.0)
* **Scheduling**: APScheduler (>=3.10.0)

---

## Features

* **Dynamic Telemetry Ingestion**: Seamless downloading of race weekend telemetry with automatic caching in a local directory (`.fastf1_cache`) to speed up consecutive requests.
* **Granular Historical Queries**: A rich REST query endpoint `/api/v1/telemetry` supporting filtering by:
  * `year`, `round`, and `session_type` (e.g., FP1, Q, R)
  * Specific `lap`
  * Time-window range (`start_time`, `end_time`)
  * Field selection (projection of specific fields like `speed`, `rpm`, `throttle`, or `brake` to minimize bandwidth)
* **Real-Time Streaming**: A WebSocket endpoint at `/ws/telemetry` supporting:
  * Live telemetry broadcasts.
  * Real-time subscription adjustments (e.g., subscribing to a specific lap mid-session).
  * Heartbeat checks (Ping/Pong) to keep connections active.
* **Aggregate Summaries**: In-memory computation of session summary stats, including average speed, max RPM, min/max speed, and brake application percentages.
* **Security Hardened**: Injected headers including `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and strict `Content-Security-Policy` limits.

---

## Getting Started

### Prerequisites

* Python 3.9 or higher installed on your machine.

### Installation

1. Clone the repository and navigate to the project root:
   ```bash
   git clone <repository-url>
   cd f1-telemetry
   ```

2. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Configuration

The application is configured using environment variables prefixed with `F1_`. 

| Environment Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `F1_APP_TITLE` | String | `F1 Telemetry Platform` | Name of the FastAPI application |
| `F1_APP_VERSION` | String | `0.1.0` | Application version number |
| `F1_LOG_LEVEL` | String | `INFO` | Log output level (DEBUG, INFO, WARNING, ERROR) |
| `F1_ALLOWED_ORIGINS` | List | `["http://localhost:3000"]` | Allowed CORS origins (JSON array string format) |
| `F1_INGESTION_INTERVAL_SECONDS` | Integer | `300` | Ingestion scheduler loop time |
| `F1_FASTF1_CACHE_DIR` | String | `.fastf1_cache` | Path where FastF1 caches raw data |
| `F1_ENABLE_SCHEDULED_INGESTION` | Boolean | `False` | Toggle the background APScheduler task loop |

Example of overriding configuration:
```bash
export F1_LOG_LEVEL="DEBUG"
export F1_ENABLE_SCHEDULED_INGESTION="True"
```

### Running the Server

Start the Uvicorn development server:
```bash
uvicorn backend.main:app --host 127.0.0.1 --reload
```

Once running, you can access:
* **Interactive API Documentation (Swagger)**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* **Alternative API Documentation (ReDoc)**: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)
* **Application Health Probe**: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

---

## Future Improvements

* **Persistent Storage Adapter**: Replace the volatile in-memory storage dictionary with a persistent PostgreSQL (using TimescaleDB) or Redis backend.
* **Authentication & Authorization**: Integrate JWT authentication or API key validation for API routes and WebSocket handshakes.
* **Granular Field-Level WebSocket Filtering**: Perform data projection at the connection manager level to broadcast only the fields requested by the subscriber.
* **Live Ingestion Feed**: Upgrade the scheduler to pull from F1 Live Timing feeds during active Grand Prix weekends.

---

## Contributing

1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

---

## Key Insight / Summary

The **F1 Telemetry Platform** bridges raw timing telemetry and real-time visual client layers. By combining FastAPI's lightweight asynchronous ASGI execution with Pandas' data manipulation capabilities, it provides a clean, extendable foundation for building rich motorsport analysis and dashboard applications.