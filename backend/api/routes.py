"""REST API routes for the F1 Telemetry Platform.

All endpoints are versioned under ``/api/v1`` and delegate business logic
to the services and FastF1 ingestion layer.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.dependencies import get_fastf1_client, get_telemetry_store
from backend.ingestion.fastf1_client import FastF1Client, _build_rotation_matrix
from backend.models.schemas import (
    CircuitDetails,
    CircuitSummary,
    SessionInfo,
    TelemetryData,
    TelemetryMetadataField,
    TelemetryQuery,
    TelemetryResponse,
)
from backend.services.circuit_store import (
    get_circuit,
    get_or_generate_circuit,
    list_circuits,
    register_circuit,
)
from backend.services.processing import ingest_and_process, process_raw_batch
from backend.services.telemetry_store import TelemetryStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["telemetry"])

# ------------------------------------------------------------------
# Static metadata & Official Presets
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

OFFICIAL_DRIVERS = [
    "VER", "PER", "LEC", "SAI", "HAM", "RUS", "NOR", "PIA",
    "ALO", "STR", "GAS", "OCO", "ALB", "SAR", "TSU", "RIC",
    "BOT", "ZHO", "HUL", "MAG",
]

DEFAULT_PRESET_SESSIONS: list[SessionInfo] = [
    SessionInfo(year=2023, round=12, session_type="R", event_name="Belgian Grand Prix (Full Race - 44 Laps)", driver="VER", circuit_id="spa", drivers=OFFICIAL_DRIVERS),
    SessionInfo(year=2023, round=1, session_type="R", event_name="Bahrain Grand Prix (Full Race - 57 Laps)", driver="VER", circuit_id="bahrain", drivers=OFFICIAL_DRIVERS),
    SessionInfo(year=2023, round=14, session_type="R", event_name="Italian Grand Prix (Full Race - 53 Laps)", driver="VER", circuit_id="monza", drivers=OFFICIAL_DRIVERS),
    SessionInfo(year=2023, round=10, session_type="R", event_name="British Grand Prix (Full Race - 52 Laps)", driver="VER", circuit_id="silverstone", drivers=OFFICIAL_DRIVERS),
    SessionInfo(year=2023, round=6, session_type="R", event_name="Monaco Grand Prix (Full Race - 78 Laps)", driver="VER", circuit_id="monaco", drivers=OFFICIAL_DRIVERS),
    SessionInfo(year=2023, round=12, session_type="Q", event_name="Belgian Grand Prix (Qualifying)", driver="VER", circuit_id="spa", drivers=OFFICIAL_DRIVERS),
    SessionInfo(year=2023, round=1, session_type="Q", event_name="Bahrain Grand Prix (Qualifying)", driver="VER", circuit_id="bahrain", drivers=OFFICIAL_DRIVERS),
]


def resolve_circuit_id_from_event(event_name: str, round_num: int) -> str:
    """Map event name or round number to circuit id."""
    lower = event_name.lower()
    if "monaco" in lower:
        return "monaco"
    if "british" in lower or "silverstone" in lower:
        return "silverstone"
    if "italian" in lower or "monza" in lower:
        return "monza"
    if "belgian" in lower or "spa" in lower:
        return "spa"
    if "japanese" in lower or "suzuka" in lower:
        return "suzuka"
    if "austrian" in lower or "spielberg" in lower or "red bull" in lower:
        return "red_bull_ring"
    if "são paulo" in lower or "brazil" in lower or "interlagos" in lower:
        return "interlagos"
    if "bahrain" in lower or "sakhir" in lower:
        return "bahrain"
    slug = lower.replace(" grand prix", "").replace("gp", "").strip().replace(" ", "_")
    return slug or "bahrain"


# ------------------------------------------------------------------
# GET /api/v1/circuits
# ------------------------------------------------------------------

@router.get(
    "/circuits",
    response_model=list[CircuitSummary],
    summary="List available F1 circuits",
)
async def list_circuits_endpoint() -> list[CircuitSummary]:
    """Return summary metadata for all supported championship circuits."""
    return [CircuitSummary(**c) for c in list_circuits()]


@router.get(
    "/circuits/{circuit_id}",
    response_model=CircuitDetails,
    summary="Get circuit details, coordinates, and turns",
)
async def get_circuit_endpoint(circuit_id: str) -> CircuitDetails:
    """Return waypoint paths and turn descriptors for a circuit."""
    c = get_circuit(circuit_id) or get_or_generate_circuit(circuit_id)
    return CircuitDetails(**c)


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
    """Return metadata for stored and preset calendar sessions."""
    stored = await store.list_sessions()
    result = list(DEFAULT_PRESET_SESSIONS)
    preset_keys = {(p.year, p.round, p.session_type) for p in result}
    for s in stored:
        if (s.year, s.round, s.session_type) not in preset_keys:
            result.append(s)
    return result


# ------------------------------------------------------------------
# GET /api/v1/telemetry
# ------------------------------------------------------------------

@router.get(
    "/telemetry",
    response_model=TelemetryResponse,
    summary="Query historical or multi-driver telemetry data",
)
async def get_telemetry(
    year: int = Query(..., ge=1950, le=2099, description="Season year"),
    round_num: Optional[int] = Query(None, alias="round", ge=1, description="Round number"),
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
    drivers: Optional[str] = Query(None, description="Comma-separated driver codes for comparison (e.g. VER,NOR,LEC)"),
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
    """Return filtered telemetry data for a session and drivers."""
    # 1. Resolve session type
    s_type = session_type or session or "Q"

    # 2. Resolve GP specifier (round or race)
    gp_spec: int | str = 1
    if round_num is not None:
        gp_spec = round_num
    elif race is not None:
        try:
            gp_spec = int(race)
        except ValueError:
            gp_spec = race
    else:
        gp_spec = 1

    # 3. Resolve driver list
    target_drivers: list[str] = []
    if drivers:
        target_drivers = [d.strip().upper() for d in drivers.split(",") if d.strip()]
    if driver and driver.strip().upper() not in target_drivers:
        target_drivers.insert(0, driver.strip().upper())
    if not target_drivers:
        target_drivers = ["VER"]

    primary_driver = target_drivers[0]

    # Parse comma-separated fields into a list
    field_list: list[str] | None = None
    if fields is not None:
        field_list = [f.strip() for f in fields.split(",") if f.strip()]

    # 4. Try to find resolved round if gp_spec is a string
    resolved_round: int | None = None
    resolved_event_name: str = ""
    if isinstance(gp_spec, int):
        resolved_round = gp_spec
    else:
        all_sessions = await list_sessions(store)
        for s in all_sessions:
            if s.year == year and s.session_type == s_type:
                if gp_spec.lower() in s.event_name.lower():
                    resolved_round = s.round
                    resolved_event_name = s.event_name
                    break

    if resolved_round is None:
        resolved_round = 1 if isinstance(gp_spec, str) else gp_spec

    # 5. Check if cached
    has_cached = await store.has_session(year, resolved_round, s_type, primary_driver)

    if not has_cached:
        logger.info(
            "Session %s/%s/%s (driver=%s) not cached — fetching from FastF1",
            year,
            gp_spec,
            s_type,
            primary_driver,
        )
        raw, resolved_driver, fetched_round, event_name = client.fetch_session_telemetry(
            year, gp_spec, s_type, primary_driver
        )

        resolved_round = fetched_round or resolved_round or 1
        primary_driver = (resolved_driver or primary_driver).upper()
        circuit_id = resolve_circuit_id_from_event(event_name, resolved_round)

        if raw:
            await ingest_and_process(
                raw_records=raw,
                year=year,
                round_number=resolved_round,
                session_type=s_type,
                driver=primary_driver,
                store=store,
                event_name=event_name,
            )
    else:
        circuit_id = resolve_circuit_id_from_event(resolved_event_name, resolved_round)

    query = TelemetryQuery(
        year=year,
        round=resolved_round,
        session_type=s_type,
        driver=primary_driver,
        lap=lap,
        start_time=start_time,
        end_time=end_time,
        fields=field_list,
    )
    base_response = await store.query_telemetry(query)
    base_response.circuit_id = circuit_id

    # If multiple drivers requested, fetch authentic telemetry for each requested driver
    drivers_data: dict[str, list[TelemetryData]] = {}
    base_data = base_response.data
    if primary_driver and base_data:
        drivers_data[primary_driver] = base_data

    # Query additional requested drivers directly from FastF1
    if len(target_drivers) > 1:
        try:
            f1_session = client.load_session(year, resolved_round, s_type)
            cinfo = f1_session.get_circuit_info()
            rot_mat = _build_rotation_matrix(float(cinfo.rotation))
            for d in target_drivers:
                if d in drivers_data:
                    continue
                d_records = client.fetch_driver_fastest_lap_telemetry(f1_session, d, rot_mat)
                if d_records:
                    drivers_data[d] = process_raw_batch(d_records)
        except Exception as e:
            logger.warning("Could not fetch comparison drivers from FastF1: %s", e)

    base_response.drivers_data = drivers_data
    return base_response


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
