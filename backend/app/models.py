"""SQLAlchemy models mirroring backend/database/schema.sql.

Single source of truth for the schema lives in schema.sql (applied by the
PostGIS container on first start). These models are the ORM view of it.
"""
from __future__ import annotations

from geoalchemy2 import Geometry
from sqlalchemy import (
    ARRAY,
    BigInteger,
    Date,
    DateTime,
    Double,
    Integer,
    String,
    Text,
    ForeignKey,
)
from sqlalchemy.dialects.postgresql import JSONB

TIMESTAMPTZ = DateTime(timezone=True)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Facility(Base):
    __tablename__ = "industrial_facilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    facility_type: Mapped[str] = mapped_column(String(100), nullable=False)
    operator: Mapped[str | None] = mapped_column(String(255))
    osm_id: Mapped[int | None] = mapped_column(BigInteger)
    latitude: Mapped[float] = mapped_column(Double, nullable=False)
    longitude: Mapped[float] = mapped_column(Double, nullable=False)
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326), nullable=False)


class ThermalEvent(Base):
    __tablename__ = "thermal_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    centroid_lat: Mapped[float] = mapped_column(Double, nullable=False)
    centroid_lon: Mapped[float] = mapped_column(Double, nullable=False)
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326), nullable=False)
    first_detected: Mapped[str] = mapped_column(TIMESTAMPTZ, nullable=False)
    last_detected: Mapped[str] = mapped_column(TIMESTAMPTZ, nullable=False)
    duration_hours: Mapped[float] = mapped_column(Double, default=0.0)
    detection_count: Mapped[int] = mapped_column(Integer, default=1)
    max_frp: Mapped[float | None] = mapped_column(Double)
    mean_frp: Mapped[float | None] = mapped_column(Double)
    total_frp: Mapped[float | None] = mapped_column(Double)
    max_brightness: Mapped[float | None] = mapped_column(Double)
    mean_brightness: Mapped[float | None] = mapped_column(Double)
    satellites: Mapped[list] = mapped_column(ARRAY(Text), default=list)
    nearest_facility_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("industrial_facilities.id")
    )
    facility_distance_m: Mapped[float | None] = mapped_column(Double)
    facilities_within_1km: Mapped[int] = mapped_column(Integer, default=0)
    facilities_within_5km: Mapped[int] = mapped_column(Integer, default=0)


class ThermalDetection(Base):
    __tablename__ = "thermal_detections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    satellite: Mapped[str] = mapped_column(String(50), nullable=False)
    instrument: Mapped[str] = mapped_column(String(50), nullable=False)
    latitude: Mapped[float] = mapped_column(Double, nullable=False)
    longitude: Mapped[float] = mapped_column(Double, nullable=False)
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326), nullable=False)
    acquisition_date: Mapped[str] = mapped_column(Date, nullable=False)
    acquisition_time: Mapped[str] = mapped_column(String(10), nullable=False)
    detection_timestamp: Mapped[str] = mapped_column(TIMESTAMPTZ, nullable=False)
    bright_ti4: Mapped[float | None] = mapped_column(Double)
    bright_ti5: Mapped[float | None] = mapped_column(Double)
    frp: Mapped[float] = mapped_column(Double, nullable=False)
    confidence: Mapped[str] = mapped_column(String(20), nullable=False)
    daynight: Mapped[str | None] = mapped_column(String(10))
    event_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("thermal_events.id", ondelete="SET NULL")
    )


class DataRefresh(Base):
    """Log of automatic FIRMS refreshes — the source of the UI's
    'updated from FIRMS' timestamp. Never 'live', always an exact time."""
    __tablename__ = "data_refreshes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    refreshed_at: Mapped[str] = mapped_column(TIMESTAMPTZ, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="FIRMS")
    days: Mapped[int] = mapped_column(Integer, nullable=False)
    detections_fetched: Mapped[int] = mapped_column(Integer, nullable=False)
    detections_new: Mapped[int] = mapped_column(Integer, nullable=False)
    events_built: Mapped[int] = mapped_column(Integer, nullable=False)


class RefreshEventSnapshot(Base):
    """Per-event state snapshot captured after each FIRMS data refresh.

    Powers the "Since last refresh" changes digest (diffing current vs previous).
    """
    __tablename__ = "refresh_event_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    refresh_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("data_refreshes.id", ondelete="CASCADE"), nullable=False
    )
    event_code: Mapped[str] = mapped_column(String(50), nullable=False)
    detection_count: Mapped[int] = mapped_column(Integer, nullable=False)
    max_frp: Mapped[float | None] = mapped_column(Double)
    tier: Mapped[str] = mapped_column(String(20), nullable=False)
    nearest_facility_km: Mapped[float | None] = mapped_column(Double)

