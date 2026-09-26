"""TRACE — Industrial Thermal Intelligence Platform API.

DB-backed endpoints over the PostGIS store. Serves the dashboard:
real FIRMS-derived thermal events for India plus OSM industrial context.

Proximity to a facility is context, not a cause: the API reports
distances and counts, never a classification.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal
import logging
import math
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db import engine, get_db
from app.models import DataRefresh, Facility, ThermalDetection, ThermalEvent

log = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _refresh_interval_hours() -> float:
    """How often the automatic FIRMS refresh runs. 0 disables it."""
    raw = os.environ.get("FIRMS_REFRESH_HOURS", "6").strip()
    try:
        hours = float(raw)
    except ValueError:
        log.warning("invalid FIRMS_REFRESH_HOURS=%r, defaulting to 6", raw)
        return 6.0
    return hours if hours > 0 else 0.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler
    hours = _refresh_interval_hours()
    if hours > 0:
        # First run shortly after boot (DB needs a moment), then on interval.
        # max_instances=1 + the state guard means a manual refresh and a
        # scheduled one never overlap.
        _scheduler = BackgroundScheduler()
        _scheduler.add_job(
            _scheduled_refresh,
            "interval",
            hours=hours,
            max_instances=1,
            coalesce=True,
            next_run_time=datetime.now() + timedelta(minutes=2),
        )
        _scheduler.start()
        log.info("automatic FIRMS refresh scheduled every %s hours", hours)
    else:
        log.info("automatic FIRMS refresh disabled (FIRMS_REFRESH_HOURS=0)")
    yield
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


app = FastAPI(
    title="TRACE Thermal Intelligence API",
    version="0.3.0",
    lifespan=lifespan,
)

# Allow the local Vite dev server to call the API from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def normalize_confidence_bucket(val: str | None) -> str:
    """Map confidence value to canonical bucket ('high', 'nominal', 'low')."""
    if not val:
        return "low"
    c = str(val).strip().lower()
    if c in ("h", "high"):
        return "high"
    if c in ("n", "nominal"):
        return "nominal"
    if c in ("l", "low"):
        return "low"
    return "low"


def parse_confidence_param(confidence: list[str] | str | None) -> set[str]:
    """Parse raw query parameter into a set of normalized bucket names ('high', 'nominal', 'low')."""
    if not confidence:
        return set()
    if isinstance(confidence, str):
        raw_items = confidence.split(",")
    else:
        raw_items = []
        for item in confidence:
            raw_items.extend(item.split(","))

    parsed = set()
    for item in raw_items:
        c = item.strip().lower()
        if c in ("h", "high"):
            parsed.add("high")
        elif c in ("n", "nominal"):
            parsed.add("nominal")
        elif c in ("l", "low"):
            parsed.add("low")
        elif c:
            parsed.add("low")
    return parsed


def get_confidence_sql_filter(selected_set: set[str]):
    """Returns SQLAlchemy condition for ThermalDetection.confidence matching selected_set."""
    if not selected_set or selected_set == {"high", "nominal", "low"}:
        return None

    has_high = "high" in selected_set
    has_nominal = "nominal" in selected_set
    has_low = "low" in selected_set

    if has_high and has_nominal and has_low:
        return None

    high_db_vals = ["high", "h"]
    nominal_db_vals = ["nominal", "n"]

    if has_high and has_nominal:
        return ThermalDetection.confidence.in_(high_db_vals + nominal_db_vals)
    elif has_high and has_low:
        return ~ThermalDetection.confidence.in_(nominal_db_vals)
    elif has_nominal and has_low:
        return ~ThermalDetection.confidence.in_(high_db_vals)
    elif has_high:
        return ThermalDetection.confidence.in_(high_db_vals)
    elif has_nominal:
        return ThermalDetection.confidence.in_(nominal_db_vals)
    elif has_low:
        return ~ThermalDetection.confidence.in_(high_db_vals + nominal_db_vals)

    return None


def get_confidence_counts_by_event(db: Session, event_ids: list[int]) -> dict[int, dict[str, int]]:
    counts: dict[int, dict[str, int]] = {eid: {"high": 0, "nominal": 0, "low": 0} for eid in event_ids}
    if not event_ids:
        return counts
    rows = (
        db.query(ThermalDetection.event_id, ThermalDetection.confidence, func.count(ThermalDetection.id))
        .filter(ThermalDetection.event_id.in_(event_ids))
        .group_by(ThermalDetection.event_id, ThermalDetection.confidence)
        .all()
    )
    for ev_id, conf_val, cnt in rows:
        if ev_id in counts:
            bucket = normalize_confidence_bucket(conf_val)
            counts[ev_id][bucket] += cnt
    return counts


def event_summary(
    ev: ThermalEvent,
    facility: Facility | None,
    confidence_counts: dict[str, int] | None = None,
) -> dict:
    if confidence_counts is None:
        confidence_counts = {"high": 0, "nominal": 0, "low": 0}
    return {
        "event_code": ev.event_code,
        "latitude": ev.centroid_lat,
        "longitude": ev.centroid_lon,
        "detection_count": ev.detection_count,
        "max_frp": ev.max_frp,
        "mean_frp": ev.mean_frp,
        "total_frp": ev.total_frp,
        "first_detected": ev.first_detected.isoformat() if ev.first_detected else None,
        "last_detected": ev.last_detected.isoformat() if ev.last_detected else None,
        "duration_hours": ev.duration_hours,
        "satellites": ev.satellites or [],
        "nearest_facility_name": facility.name if facility else None,
        "nearest_facility_type": facility.facility_type if facility else None,
        "facility_distance_m": ev.facility_distance_m,
        "facilities_within_1km": ev.facilities_within_1km,
        "facilities_within_5km": ev.facilities_within_5km,
        "confidence_counts": confidence_counts,
    }


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(select(func.count()).select_from(Facility))
        db_status = "ok"
    except Exception:
        db_status = "error"
    return {"status": "ok", "db": db_status}


@app.get("/statistics")
def statistics(db: Session = Depends(get_db)) -> dict:
    total_events = db.query(func.count(ThermalEvent.id)).scalar()
    total_detections = db.query(func.coalesce(func.sum(ThermalEvent.detection_count), 0)).scalar()
    total_facilities = db.query(func.count(Facility.id)).scalar()
    within_1km = db.query(func.count(ThermalEvent.id)).filter(ThermalEvent.facility_distance_m <= 1000).scalar()
    within_5km = db.query(func.count(ThermalEvent.id)).filter(ThermalEvent.facility_distance_m <= 5000).scalar()
    by_type = dict(
        db.query(Facility.facility_type, func.count(Facility.id)).group_by(Facility.facility_type).all()
    )
    date_range = db.query(func.min(ThermalEvent.first_detected), func.max(ThermalEvent.last_detected)).one()
    return {
        "total_events": total_events,
        "total_detections": int(total_detections),
        "total_facilities": total_facilities,
        "events_within_1km_of_facility": within_1km,
        "events_within_5km_of_facility": within_5km,
        "facilities_by_type": by_type,
        "date_range": {
            "from": date_range[0].isoformat() if date_range[0] else None,
            "to": date_range[1].isoformat() if date_range[1] else None,
        },
        "proximity_note": (
            "Proximity to an industrial facility is context for analysts, "
            "not evidence of what caused the thermal event."
        ),
    }


@app.get("/events")
def list_events(
    db: Session = Depends(get_db),
    min_detections: int = Query(1, ge=1),
    satellite: str | None = Query(None, description="e.g. VIIRS_SNPP_NRT"),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    min_lon: float | None = Query(None),
    min_lat: float | None = Query(None),
    max_lon: float | None = Query(None),
    max_lat: float | None = Query(None),
    near_facility_km: float | None = Query(None, description="only events this close to a facility"),
    confidence: list[str] | None = Query(None, description="confidence levels e.g. high,nominal or h,n"),
    sort: Literal["detections", "frp", "recent"] = Query("detections"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    q = db.query(ThermalEvent).filter(ThermalEvent.detection_count >= min_detections)
    if satellite:
        q = q.filter(ThermalEvent.satellites.any(satellite))
    if date_from:
        q = q.filter(ThermalEvent.last_detected >= date_from)
    if date_to:
        q = q.filter(ThermalEvent.first_detected <= date_to)
    if None not in (min_lon, min_lat, max_lon, max_lat):
        q = q.filter(
            ThermalEvent.centroid_lon >= min_lon,
            ThermalEvent.centroid_lon <= max_lon,
            ThermalEvent.centroid_lat >= min_lat,
            ThermalEvent.centroid_lat <= max_lat,
        )
    if near_facility_km is not None:
        q = q.filter(ThermalEvent.facility_distance_m <= near_facility_km * 1000)

    selected_conf = parse_confidence_param(confidence)
    conf_filter = get_confidence_sql_filter(selected_conf)
    if conf_filter is not None:
        subq = db.query(ThermalDetection.event_id).filter(conf_filter).distinct()
        q = q.filter(ThermalEvent.id.in_(subq))

    total = q.count()
    order = {
        "detections": ThermalEvent.detection_count.desc(),
        "frp": ThermalEvent.max_frp.desc(),
        "recent": ThermalEvent.last_detected.desc(),
    }[sort]
    events = q.order_by(order).offset(offset).limit(limit).all()

    fac_ids = {e.nearest_facility_id for e in events if e.nearest_facility_id}
    fac_map = (
        {f.id: f for f in db.query(Facility).filter(Facility.id.in_(fac_ids)).all()}
        if fac_ids
        else {}
    )

    ev_ids = [e.id for e in events]
    conf_counts = get_confidence_counts_by_event(db, ev_ids)

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "events": [
            event_summary(e, fac_map.get(e.nearest_facility_id), conf_counts.get(e.id))
            for e in events
        ],
    }


@app.get("/events/{event_code}")
def event_detail(event_code: str, db: Session = Depends(get_db)) -> dict:
    ev = db.query(ThermalEvent).filter(ThermalEvent.event_code == event_code).one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="event not found")
    facility = (
        db.query(Facility).filter(Facility.id == ev.nearest_facility_id).one_or_none()
        if ev.nearest_facility_id
        else None
    )
    conf_counts = get_confidence_counts_by_event(db, [ev.id]).get(ev.id)
    detail = event_summary(ev, facility, conf_counts)
    detail.update(
        {
            "max_brightness": ev.max_brightness,
            "mean_brightness": ev.mean_brightness,
            "nearest_facility": (
                {
                    "name": facility.name,
                    "type": facility.facility_type,
                    "operator": facility.operator,
                    "latitude": facility.latitude,
                    "longitude": facility.longitude,
                }
                if facility
                else None
            ),
        }
    )
    return detail


@app.get("/events/{event_code}/detections")
def event_detections(
    event_code: str,
    confidence: list[str] | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    """Per-detection time series for one event: timestamp + FRP per pass.

    Powers the heat-over-time chart. Ordered oldest first.
    """
    ev = db.query(ThermalEvent).filter(ThermalEvent.event_code == event_code).one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="event not found")
    
    q = db.query(ThermalDetection).filter(ThermalDetection.event_id == ev.id)
    
    selected_conf = parse_confidence_param(confidence)
    conf_filter = get_confidence_sql_filter(selected_conf)
    if conf_filter is not None:
        q = q.filter(conf_filter)

    rows = q.order_by(ThermalDetection.detection_timestamp.asc()).all()
    return {
        "event_code": event_code,
        "count": len(rows),
        "detections": [
            {
                "timestamp": r.detection_timestamp.isoformat() if r.detection_timestamp else None,
                "frp": r.frp,
                "satellite": r.satellite,
                "brightness": r.bright_ti4,
                "daynight": r.daynight,
                "confidence": normalize_confidence_bucket(r.confidence),
            }
            for r in rows
        ],
    }


@app.get("/facilities")
def list_facilities(
    db: Session = Depends(get_db),
    kind: str | None = Query(None, description="works | power_plant | industrial_site | petroleum_well"),
    min_lon: float | None = Query(None),
    min_lat: float | None = Query(None),
    max_lon: float | None = Query(None),
    max_lat: float | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
) -> dict:
    q = db.query(Facility)
    if kind:
        q = q.filter(Facility.facility_type == kind)
    if None not in (min_lon, min_lat, max_lon, max_lat):
        q = q.filter(
            Facility.longitude >= min_lon,
            Facility.longitude <= max_lon,
            Facility.latitude >= min_lat,
            Facility.latitude <= max_lat,
        )
    total = q.count()
    rows = q.order_by(Facility.id).offset(offset).limit(limit).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "facilities": [
            {
                "id": f.id,
                "name": f.name,
                "type": f.facility_type,
                "operator": f.operator,
                "latitude": f.latitude,
                "longitude": f.longitude,
            }
            for f in rows
        ],
    }


@app.get("/facilities/clusters")
def facility_clusters(
    db: Session = Depends(get_db),
    min_lon: float = Query(...),
    min_lat: float = Query(...),
    max_lon: float = Query(...),
    max_lat: float = Query(...),
    zoom: int = Query(..., ge=0, le=22),
    kind: str | None = Query(None, description="works | power_plant | industrial_site | petroleum_well"),
) -> dict:
    base_filters = [
        Facility.longitude >= min_lon,
        Facility.longitude <= max_lon,
        Facility.latitude >= min_lat,
        Facility.latitude <= max_lat,
    ]
    if kind:
        base_filters.append(Facility.facility_type == kind)

    total = db.query(func.count(Facility.id)).filter(*base_filters).scalar() or 0

    if total == 0:
        return {"total": 0, "clusters": []}

    lat_center = max(-85.0, min(85.0, (min_lat + max_lat) / 2.0))
    lat_rad = math.radians(lat_center)
    meters_per_pixel = 156543.03 * math.cos(lat_rad) / (2.0 ** zoom)
    cell_meters = 48.0 * meters_per_pixel

    cell_deg_lat = max(0.00001, cell_meters / 111320.0)
    cell_deg_lon = max(0.00001, cell_meters / (111320.0 * max(0.0001, math.cos(lat_rad))))

    grid_lon = func.floor(Facility.longitude / cell_deg_lon)
    grid_lat = func.floor(Facility.latitude / cell_deg_lat)

    rows = (
        db.query(
            func.count(Facility.id).label("count"),
            func.avg(Facility.latitude).label("avg_lat"),
            func.avg(Facility.longitude).label("avg_lon"),
            func.max(Facility.id).label("max_id"),
        )
        .filter(*base_filters)
        .group_by(grid_lon, grid_lat)
        .all()
    )

    single_ids = [r.max_id for r in rows if r.count == 1]
    single_facs = (
        {f.id: f for f in db.query(Facility).filter(Facility.id.in_(single_ids)).all()}
        if single_ids
        else {}
    )

    clusters = []
    for r in rows:
        count = r.count
        if count == 1:
            fac = single_facs.get(r.max_id)
            if fac:
                clusters.append(
                    {
                        "count": 1,
                        "latitude": round(fac.latitude, 6),
                        "longitude": round(fac.longitude, 6),
                        "facility": {
                            "id": fac.id,
                            "name": fac.name,
                            "type": fac.facility_type,
                            "operator": fac.operator,
                        },
                    }
                )
            else:
                clusters.append(
                    {
                        "count": 1,
                        "latitude": round(float(r.avg_lat), 6),
                        "longitude": round(float(r.avg_lon), 6),
                    }
                )
        else:
            clusters.append(
                {
                    "count": count,
                    "latitude": round(float(r.avg_lat), 6),
                    "longitude": round(float(r.avg_lon), 6),
                }
            )

    return {"total": total, "clusters": clusters}


# ---- Automatic FIRMS refresh ----
# POST /admin/refresh triggers a full fetch -> cluster -> enrich -> load cycle
# in the background (key from NASA_FIRMS_MAP_KEY env). The UI must present the
# result as "updated from FIRMS" with the exact timestamp from /data-status —
# never "live".

_refresh_state: dict = {"state": "idle", "detail": None, "summary": None}


def _run_refresh(days: int | None) -> None:
    from app.db import SessionLocal
    from app.services.refresh import refresh_from_firms

    db = SessionLocal()
    try:
        _refresh_state["detail"] = f"fetching {days}-day FIRMS window"
        summary = refresh_from_firms(db, days=days)
        _refresh_state["state"] = "done"
        _refresh_state["detail"] = None
        _refresh_state["summary"] = summary
    except Exception as exc:  # surfaced via the status endpoint, never raised
        log.exception("automatic FIRMS refresh failed")
        _refresh_state["state"] = "failed"
        _refresh_state["detail"] = str(exc)
    finally:
        db.close()


def _scheduled_refresh() -> None:
    """APScheduler entrypoint: skip if a refresh (manual or scheduled) is
    already running, otherwise run the full FIRMS refresh cycle."""
    if _refresh_state["state"] == "running":
        log.info("scheduled FIRMS refresh skipped: another refresh is running")
        return
    _refresh_state.update(state="running", detail="scheduled refresh", summary=None)
    _run_refresh(None)


@app.post("/admin/refresh")
def trigger_refresh(
    background_tasks: BackgroundTasks,
    days: int | None = Query(None, ge=1, le=5, description="FIRMS day range, 1-5 (default from env)"),
) -> dict:
    if _refresh_state["state"] == "running":
        raise HTTPException(status_code=409, detail="a refresh is already running")
    _refresh_state.update(state="running", detail="starting", summary=None)
    background_tasks.add_task(_run_refresh, days)
    return {"status": "started", "days": days}


@app.get("/admin/refresh/status")
def refresh_status() -> dict:
    return dict(_refresh_state)


@app.get("/data-status")
def data_status(db: Session = Depends(get_db)) -> dict:
    latest = db.query(DataRefresh).order_by(DataRefresh.id.desc()).first()
    if latest is None:
        return {"refreshed": False}
    return {
        "refreshed": True,
        "source": latest.source,
        "refreshed_at": latest.refreshed_at.isoformat(),
        "days": latest.days,
        "detections_fetched": latest.detections_fetched,
        "detections_new": latest.detections_new,
        "events_built": latest.events_built,
    }
