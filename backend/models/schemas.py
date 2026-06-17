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
    payload: TelemetryData
    year: int | None = None
    round: int | None = None
    session_type: str | None = None
    driver: str | None = None


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


# ---------------------------------------------------------------------------
# Field metadata
# ---------------------------------------------------------------------------

class TelemetryMetadataField(BaseModel):
    """Describes a single telemetry field and its unit of measurement."""

    name: str
    unit: str
    description: str = ""
