"""REST API routes for the F1 Telemetry Platform.

All endpoints are versioned under ``/api/v1`` and delegate business logic
to the services layer.  Request validation is handled by Pydantic query
models; responses use the canonical data contracts.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.dependencies import get_fastf1_client, get_telemetry_store
from backend.ingestion.fastf1_client import FastF1Client
from backend.models.schemas import (
    SessionInfo,
    TelemetryMetadataField,
    TelemetryQuery,
    TelemetryResponse,
)
from backend.services.processing import ingest_and_process
from backend.services.telemetry_store import TelemetryStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["telemetry"])

# ------------------------------------------------------------------
# Static metadata
# ------------------------------------------------------------------

_FIELD_METADATA: list[TelemetryMetadataField] = [
    TelemetryMetadataField(name="timestamp", unit="s", description="Seconds from session start"),
    TelemetryMetadataField(name="lap", unit="#", description="Lap number"),
    TelemetryMetadataField(name="speed", unit="km/h", description="Car speed"),
    TelemetryMetadataField(name="throttle", unit="%", description="Throttle application"),
    TelemetryMetadataField(name="brake", unit="%", description="Brake application"),
    TelemetryMetadataField(name="gear", unit="#", description="Current gear (0=neutral)"),
    TelemetryMetadataField(name="rpm", unit="rpm", description="Engine revolutions per minute"),
]


def load_example_data() -> list[dict[str, Any]]:
    """Load example telemetry records from the project root data directory."""
    try:
        # Resolve data/example.json path relative to workspace root
        root_dir = Path(__file__).resolve().parent.parent.parent
        example_path = root_dir / "data" / "example.json"
        with open(example_path, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error("Failed to load example telemetry data: %s", e)
        return []


# ------------------------------------------------------------------
# GET /api/v1/sessions
# ------------------------------------------------------------------

@router.get(
    "/sessions",
    response_model=list[SessionInfo],
    summary="List available telemetry sessions",
)
async def list_sessions(
    store: TelemetryStore = Depends(get_telemetry_store),
) -> list[SessionInfo]:
    """Return metadata for every session that has been ingested."""
    return await store.list_sessions()


# ------------------------------------------------------------------
# GET /api/v1/telemetry
# ------------------------------------------------------------------

@router.get(
    "/telemetry",
    response_model=TelemetryResponse,
    summary="Query historical telemetry data",
)
async def get_telemetry(
    year: int = Query(..., ge=1950, le=2099, description="Season year"),
    round: Optional[int] = Query(None, ge=1, description="Round number"),
    race: Optional[str] = Query(None, description="Race name or round number"),
    session_type: Optional[str] = Query(
        None,
        min_length=1,
        max_length=10,
        pattern=r"^[A-Za-z0-9]+$",
        description="Session code (FP1, Q, R, …)",
    ),
    session: Optional[str] = Query(None, description="Session code (FP1, Q, R, …)"),
    driver: Optional[str] = Query(None, description="Driver code (e.g. VER, HAM)"),
    lap: Optional[int] = Query(None, ge=1, description="Specific lap"),
    start_time: Optional[float] = Query(None, ge=0, description="Start seconds"),
    end_time: Optional[float] = Query(None, ge=0, description="End seconds"),
    fields: Optional[str] = Query(
        None,
        description="Comma-separated field names to include",
    ),
    store: TelemetryStore = Depends(get_telemetry_store),
    client: FastF1Client = Depends(get_fastf1_client),
) -> TelemetryResponse:
    """Return filtered telemetry data for a session.

    If the session has not been ingested yet, the endpoint will attempt a
    live fetch from FastF1 and cache the results. If live timing is not available,
    it falls back to loading sample telemetry data from `/data/example.json`.
    """
    # 1. Resolve session type
    s_type = session_type or session or "Q"

    # 2. Resolve GP specifier (round or race)
    gp_spec: int | str = 1
    if round is not None:
        gp_spec = round
    elif race is not None:
        try:
            gp_spec = int(race)
        except ValueError:
            gp_spec = race
    else:
        gp_spec = 1

    # 3. Resolve driver
    driver_upper = driver.strip().upper() if driver else None

    # Parse comma-separated fields into a list
    field_list: list[str] | None = None
    if fields is not None:
        field_list = [f.strip() for f in fields.split(",") if f.strip()]

    # 4. Try to find resolved round if gp_spec is a string
    resolved_round: int | None = None
    if isinstance(gp_spec, int):
        resolved_round = gp_spec
    else:
        sessions = await store.list_sessions()
        for s in sessions:
            if s.year == year and s.session_type == s_type:
                if gp_spec.lower() in s.event_name.lower():
                    resolved_round = s.round
                    break

    # 5. Check if cached
    has_cached = False
    if resolved_round is not None:
        has_cached = await store.has_session(year, resolved_round, s_type, driver_upper)

    if not has_cached:
        logger.info(
            "Session %s/%s/%s (driver=%s) not cached — fetching from FastF1",
            year,
            gp_spec,
            s_type,
            driver_upper,
        )
        raw, resolved_driver, fetched_round, event_name = client.fetch_session_telemetry(
            year, gp_spec, s_type, driver_upper
        )

        if not raw:
            logger.warning(
                "No live telemetry found for %s/%s/%s (driver=%s) — using fallback example data",
                year,
                gp_spec,
                s_type,
                driver_upper,
            )
            raw = load_example_data()
            resolved_driver = driver_upper or "VER"
            resolved_round = resolved_round or fetched_round or (gp_spec if isinstance(gp_spec, int) else 1)
            if resolved_round == 0:
                resolved_round = 1
            event_name = event_name or (gp_spec if isinstance(gp_spec, str) else f"Grand Prix Round {resolved_round}")
        else:
            resolved_round = fetched_round

        driver_upper = resolved_driver.upper()

        await ingest_and_process(
            raw_records=raw,
            year=year,
            round_number=resolved_round,
            session_type=s_type,
            driver=driver_upper,
            store=store,
            event_name=event_name,
        )

    # At this point, resolved_round is guaranteed to be set
    query = TelemetryQuery(
        year=year,
        round=resolved_round,
        session_type=s_type,
        driver=driver_upper,
        lap=lap,
        start_time=start_time,
        end_time=end_time,
        fields=field_list,
    )
    return await store.query_telemetry(query)


# ------------------------------------------------------------------
# GET /api/v1/telemetry/metadata
# ------------------------------------------------------------------

@router.get(
    "/telemetry/metadata",
    response_model=list[TelemetryMetadataField],
    summary="Retrieve telemetry field descriptors",
)
async def get_telemetry_metadata() -> list[TelemetryMetadataField]:
    """Return the list of available telemetry fields with units."""
    return _FIELD_METADATA
