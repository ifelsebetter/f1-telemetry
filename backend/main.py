"""F1 Telemetry Platform — Application entry point.

Start the server with::

    uvicorn backend.main:app --host 127.0.0.1 --reload

The application registers:
- REST routes under ``/api/v1``
- A WebSocket endpoint at ``/ws/telemetry``
- Security-hardened middleware (CORS, security headers)
- Lifespan hooks that initialise shared services
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add project root to sys.path to allow running from within the backend directory
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import router as api_router
from backend.api.websocket import ws_router
from backend.config import settings
from backend.ingestion.fastf1_client import FastF1Client
from backend.ingestion.scheduler import start_scheduler, stop_scheduler
from backend.services.telemetry_store import TelemetryStore
from backend.services.ws_manager import ConnectionManager

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Lifespan — startup / shutdown
# ------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialise shared services on startup, clean up on shutdown."""

    # --- Startup ---
    app.state.telemetry_store = TelemetryStore()
    app.state.ws_manager = ConnectionManager()
    app.state.fastf1_client = FastF1Client()

    logger.info("Services initialised")

    start_scheduler()

    yield

    # --- Shutdown ---
    stop_scheduler()
    logger.info("Application shutdown complete")


# ------------------------------------------------------------------
# App factory
# ------------------------------------------------------------------

app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description=(
        "Real-time and historical F1 telemetry data platform. "
        "Provides REST and WebSocket APIs for speed, throttle, brake, "
        "gear, and RPM data sourced from FastF1."
    ),
    lifespan=lifespan,
)


# ------------------------------------------------------------------
# Middleware — CORS
# ------------------------------------------------------------------

# TODO(security): Tighten allowed_origins for production deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Content-Type", "Accept"],
)


# ------------------------------------------------------------------
# Middleware — Security headers
# ------------------------------------------------------------------

@app.middleware("http")
async def add_security_headers(request: Request, call_next: object) -> Response:
    """Inject recommended security headers into every HTTP response."""
    response: Response = await call_next(request)  # type: ignore[call-arg]

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=(), payment=()"
    )
    
    # Relax CSP for interactive API documentation endpoints so they can load CDN resources
    if request.url.path in ("/docs", "/redoc", "/openapi.json"):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "img-src 'self' data: https://fastapi.tiangolo.com; "
            "frame-ancestors 'none'"
        )
    else:
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'"
        )

    return response


# ------------------------------------------------------------------
# Routers
# ------------------------------------------------------------------

app.include_router(api_router)
app.include_router(ws_router)


# ------------------------------------------------------------------
# Health check
# ------------------------------------------------------------------

@app.get("/health", tags=["ops"], summary="Health check")
async def health_check() -> dict[str, str]:
    """Simple liveness probe."""
    return {"status": "ok"}
