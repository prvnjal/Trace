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
from app.models import Base, DataRefresh, Facility, RefreshEventSnapshot, ThermalDetection, ThermalEvent
from app.services.refresh import ensure_initial_snapshot

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
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        log.warning("Could not create DB tables automatically: %s", exc)

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
        "landuse_class": ev.landuse_class or "unknown",
        "landuse_tag": ev.landuse_tag,
        "landuse_inside": ev.landuse_inside,
        "landuse_distance_m": ev.landuse_distance_m,
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

    Powers the heat-over-time chart, the satellite corroboration strip, the
    detection-character panels and the footprint map. Ordered oldest first.
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
                "latitude": r.latitude,
                "longitude": r.longitude,
            }
            for r in rows
        ],
    }


@app.get("/changes/since-last-refresh")
def changes_since_last_refresh(db: Session = Depends(get_db)) -> dict:
    """Digest of changes since the previous data refresh (new events, growing events, cooled off count)."""
    ensure_initial_snapshot(db)

    refreshed_ids = (
        db.query(RefreshEventSnapshot.refresh_id, DataRefresh.refreshed_at)
        .join(DataRefresh, RefreshEventSnapshot.refresh_id == DataRefresh.id)
        .group_by(RefreshEventSnapshot.refresh_id, DataRefresh.refreshed_at)
        .order_by(DataRefresh.refreshed_at.desc())
        .all()
    )

    empty_response = {
        "since": None,
        "note": "No previous refresh to compare against yet",
        "new_events": [],
        "grown_events": [],
        "new_near_industry": [],
        "cooled_off_count": 0,
        "counts": {
            "new_events_count": 0,
            "grown_events_count": 0,
            "new_near_industry_count": 0,
        },
    }

    if len(refreshed_ids) < 2:
        return empty_response

    curr_refresh_id = refreshed_ids[0][0]
    prev_refresh_id = refreshed_ids[1][0]
    prev_refreshed_at = refreshed_ids[1][1]

    since_str = prev_refreshed_at.isoformat() if prev_refreshed_at else None

    prev_snaps = {
        s.event_code: s
        for s in db.query(RefreshEventSnapshot)
        .filter(RefreshEventSnapshot.refresh_id == prev_refresh_id)
        .all()
    }
    curr_snaps = {
        s.event_code: s
        for s in db.query(RefreshEventSnapshot)
        .filter(RefreshEventSnapshot.refresh_id == curr_refresh_id)
        .all()
    }

    prev_codes = set(prev_snaps.keys())
    curr_codes = set(curr_snaps.keys())

    new_codes = curr_codes - prev_codes
    cooled_off_count = len(prev_codes - curr_codes)

    grown_items = []
    common_codes = curr_codes & prev_codes
    for code in common_codes:
        p_cnt = prev_snaps[code].detection_count
        c_cnt = curr_snaps[code].detection_count
        delta = c_cnt - p_cnt
        if delta >= 5 or (p_cnt > 0 and c_cnt >= 2 * p_cnt and delta > 0):
            grown_items.append({
                "event_code": code,
                "previous_count": p_cnt,
                "current_count": c_cnt,
                "delta": delta,
                "tier": curr_snaps[code].tier,
            })

    grown_items.sort(key=lambda x: x["delta"], reverse=True)

    needed_codes = new_codes | {g["event_code"] for g in grown_items}
    events_orm = (
        db.query(ThermalEvent)
        .filter(ThermalEvent.event_code.in_(needed_codes))
        .all()
        if needed_codes
        else []
    )
    events_by_code = {e.event_code: e for e in events_orm}

    fac_ids = {e.nearest_facility_id for e in events_orm if e.nearest_facility_id}
    fac_map = (
        {f.id: f for f in db.query(Facility).filter(Facility.id.in_(fac_ids)).all()}
        if fac_ids
        else {}
    )
    ev_ids = [e.id for e in events_orm]
    conf_counts = get_confidence_counts_by_event(db, ev_ids)

    new_events_all = []
    for code in new_codes:
        ev = events_by_code.get(code)
        if ev:
            summary = event_summary(ev, fac_map.get(ev.nearest_facility_id), conf_counts.get(ev.id))
            new_events_all.append(summary)

    new_events_all.sort(key=lambda x: x["detection_count"], reverse=True)
    new_events_count = len(new_events_all)
    new_events_capped = new_events_all[:20]

    new_near_industry = [
        e for e in new_events_all
        if e.get("facility_distance_m") is not None and e["facility_distance_m"] <= 1000
    ]
    new_near_industry_count = len(new_near_industry)

    enriched_grown = []
    for g in grown_items:
        code = g["event_code"]
        ev = events_by_code.get(code)
        fac = fac_map.get(ev.nearest_facility_id) if ev else None
        item = {
            "event_code": code,
            "previous_count": g["previous_count"],
            "current_count": g["current_count"],
            "delta": g["delta"],
            "tier": g["tier"],
            "nearest_facility_name": fac.name if fac else None,
            "nearest_facility_type": fac.facility_type if fac else None,
            "facility_distance_m": ev.facility_distance_m if ev else None,
            "event_summary": event_summary(ev, fac, conf_counts.get(ev.id)) if ev else None,
        }
        enriched_grown.append(item)

    return {
        "since": since_str,
        "note": None,
        "new_events": new_events_capped,
        "grown_events": enriched_grown,
        "new_near_industry": new_near_industry[:20],
        "cooled_off_count": cooled_off_count,
        "counts": {
            "new_events_count": new_events_count,
            "grown_events_count": len(enriched_grown),
            "new_near_industry_count": new_near_industry_count,
        },
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
        # The stage label is updated by refresh_from_firms via this callback,
        # so /admin/refresh/status reflects the real phase (fetch / cluster /
        # land-cover tagging) instead of freezing on the first line.
        def _progress(label: str) -> None:
            _refresh_state["detail"] = label

        summary = refresh_from_firms(db, days=days, progress=_progress)
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
