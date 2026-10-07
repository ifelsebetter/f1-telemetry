"""Pydantic data contracts for the F1 Telemetry Platform.

These models define the canonical data shapes exchanged between all modules
and exposed via the public API.  They map directly to the architecture spec's
``data_contracts`` section.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Core telemetry record
# ---------------------------------------------------------------------------

class TelemetryData(BaseModel):
    """Single telemetry sample for one point in time during a lap."""

    timestamp: float = Field(
        ..., description="Seconds elapsed from session start"
    )
    lap: int = Field(..., ge=1, description="Lap number")
    speed: float = Field(..., ge=0, description="Speed in km/h")
    throttle: float = Field(
        ..., ge=0.0, le=100.0, description="Throttle percentage (0–100)"
    )
    brake: float = Field(
        ..., ge=0.0, le=100.0, description="Brake percentage (0–100)"
    )
    gear: int = Field(..., ge=0, le=8, description="Gear number (0 = neutral)")
    rpm: float = Field(..., ge=0, description="Engine RPM")
    x: float = Field(0.0, description="Track X coordinate in meters")
    y: float = Field(0.0, description="Track Y coordinate in meters")
    z: float = Field(0.0, description="Track Z coordinate in meters")
    steer: float = Field(0.0, ge=-1.0, le=1.0, description="Steering input (-1.0 to 1.0)")
    ers_soc: float = Field(100.0, ge=0.0, le=100.0, description="ERS battery charge %")
    ers_harvest: float = Field(0.0, ge=0.0, description="MGU-K harvest power in kW")
    tyre_temp_fl: float = Field(90.0, description="Front Left tyre temp °C")
    tyre_temp_fr: float = Field(90.0, description="Front Right tyre temp °C")
    tyre_temp_rl: float = Field(90.0, description="Rear Left tyre temp °C")
    tyre_temp_rr: float = Field(90.0, description="Rear Right tyre temp °C")
    tyre_wear: float = Field(0.0, ge=0.0, le=100.0, description="Tyre wear percentage")
    tyre_compound: str = Field("SOFT", description="Tyre compound")
    drs: bool = Field(False, description="DRS flap status")
    flag: str = Field("GREEN", description="FIA track flag")
    safety_car: str = Field("NONE", description="Safety car status")
    delta_to_ghost: float = Field(0.0, description="Delta to ghost reference lap (seconds)")
    sector: int = Field(1, ge=1, le=3, description="Current sector number")
    mini_sector: int = Field(1, ge=1, description="Mini-sector index")
    distance: float = Field(0.0, description="Distance along track in meters")
    dist_remaining: float = Field(0.0, description="Remaining lap distance in meters")
    live_speed_ms: float = Field(0.0, description="Speed in meters per second (m/s)")
    eta_seconds: float = Field(0.0, description="Real-time estimated seconds to complete lap")
    lap_time: float = Field(0.0, description="Elapsed seconds in current lap")
    race_time: float = Field(0.0, description="Elapsed seconds in race")
    total_laps: int = Field(1, description="Total race laps")
    total_race_duration: float = Field(0.0, description="Total race duration in seconds")
    race_eta_seconds: float = Field(0.0, description="Remaining seconds to race finish")


# ---------------------------------------------------------------------------
# Query parameters
# ---------------------------------------------------------------------------

class TelemetryQuery(BaseModel):
    """Parameters used to filter historical telemetry data."""

    year: int = Field(..., ge=1950, le=2099, description="Season year")
    round: int = Field(..., ge=1, description="Race weekend round number")
    session_type: str = Field(
        ...,
        min_length=1,
        max_length=10,
        pattern=r"^[A-Za-z0-9]+$",
        description="Session type code (e.g. FP1, Q, R, S)",
    )
    driver: str | None = Field(
        None, description="Driver code (optional)"
    )
    lap: int | None = Field(
        None, ge=1, description="Filter to a specific lap (optional)"
    )
    start_time: float | None = Field(
        None, ge=0, description="Start of time window in seconds (optional)"
    )
    end_time: float | None = Field(
        None, ge=0, description="End of time window in seconds (optional)"
    )
    fields: list[str] | None = Field(
        None,
        description="Subset of fields to return (optional); "
        "if omitted all fields are returned",
    )


# ---------------------------------------------------------------------------
# API responses
# ---------------------------------------------------------------------------

class TelemetryResponse(BaseModel):
    """Wrapper returned by the historical telemetry endpoint."""

    data: list[TelemetryData] = Field(default_factory=list)
    summary: dict[str, Any] = Field(
        default_factory=dict,
        description="Aggregate statistics (avg speed, max RPM, etc.)",
    )
    year: int | None = Field(None, description="Season year")
    round: int | None = Field(None, description="Race weekend round number")
    session_type: str | None = Field(None, description="Session type code (e.g. FP1, Q, R, S)")
    event_name: str | None = Field(None, description="Event name")
    driver: str | None = Field(None, description="Driver code")
    circuit_id: str | None = Field(None, description="Circuit identifier")
    drivers_data: dict[str, list[TelemetryData]] = Field(
        default_factory=dict,
        description="Telemetry points keyed by driver abbreviation for multi-driver queries",
    )


class ErrorResponse(BaseModel):
    """Standard error payload."""

    detail: str


# ---------------------------------------------------------------------------
# WebSocket messages
# ---------------------------------------------------------------------------

class TelemetryStreamMessage(BaseModel):
    """Envelope sent to WebSocket subscribers."""

    type: str = Field(
        ..., description="Message type, e.g. 'telemetry_update'"
    )
    payload: TelemetryData | None = None
    multi_payload: dict[str, TelemetryData] | None = None
    year: int | None = None
    round: int | None = None
    session_type: str | None = None
    driver: str | None = None
    circuit_id: str | None = None
    lap_duration: float | None = Field(None, description="Total lap duration in seconds")
    track_length_m: float | None = Field(None, description="Total track length in meters")
    current_lap: int | None = Field(1, description="Current race lap")
    total_laps: int | None = Field(1, description="Total race laps")
    race_time: float | None = Field(None, description="Elapsed race time in seconds")
    total_race_duration: float | None = Field(None, description="Total race duration in seconds")
    race_eta_seconds: float | None = Field(None, description="Remaining seconds to race finish")


# ---------------------------------------------------------------------------
# Session metadata
# ---------------------------------------------------------------------------

class SessionInfo(BaseModel):
    """Metadata describing a stored telemetry session."""

    year: int
    round: int
    session_type: str
    event_name: str = ""
    driver: str = ""
    circuit_id: str = "bahrain"
    drivers: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Circuit models
# ---------------------------------------------------------------------------

class CircuitSummary(BaseModel):
    """Summary metadata for an F1 circuit."""

    id: str
    name: str
    location: str
    country: str
    length_km: float
    laps: int
    turns_count: int


class CircuitWaypoint(BaseModel):
    """Single circuit coordinate waypoint."""

    x: float
    y: float
    sector: int = 1
    turn: str | None = None
    drs: bool = False


class CircuitDetails(CircuitSummary):
    """Full circuit details with coordinates, turns, and DRS zones."""

    waypoints: list[dict[str, Any]] = Field(default_factory=list)
    turns: list[dict[str, Any]] = Field(default_factory=list)
    drs_zones: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Field metadata
# ---------------------------------------------------------------------------

class TelemetryMetadataField(BaseModel):
    """Describes a single telemetry field and its unit of measurement."""

    name: str
    unit: str
    description: str = ""

