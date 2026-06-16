"""REST API routes for the F1 Telemetry Platform.

All endpoints are versioned under ``/api/v1`` and delegate business logic
to the services layer.  Request validation is handled by Pydantic query
models; responses use the canonical data contracts.
"""

from __future__ import annotations

import logging
from typing import Optional

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
    round: int = Query(..., ge=1, alias="round", description="Round number"),
    session_type: str = Query(
        ...,
        min_length=1,
        max_length=10,
        pattern=r"^[A-Za-z0-9]+$",
        description="Session code (FP1, Q, R, …)",
    ),
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
    live fetch from FastF1 and cache the results.
    """
    # Parse comma-separated fields into a list
    field_list: list[str] | None = None
    if fields is not None:
        field_list = [f.strip() for f in fields.split(",") if f.strip()]

    # Auto-ingest on first request if not already cached
    if not await store.has_session(year, round, session_type):
        logger.info(
            "Session %s/%s/%s not cached — fetching from FastF1",
            year,
            round,
            session_type,
        )
        raw = client.fetch_session_telemetry(year, round, session_type)
        if not raw:
            raise HTTPException(
                status_code=404,
                detail=f"No telemetry found for {year}/{round}/{session_type}",
            )
        await ingest_and_process(
            raw_records=raw,
            year=year,
            round_number=round,
            session_type=session_type,
            store=store,
        )

    query = TelemetryQuery(
        year=year,
        round=round,
        session_type=session_type,
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
