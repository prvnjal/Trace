"""Automatic FIRMS refresh: fetch -> normalize -> cluster -> enrich -> load.

One call does the whole chain that used to be manual (browser CSV download,
pipeline_run.py, enrich_events.py, load_db.py):

    from app.services.refresh import refresh_from_firms
    summary = refresh_from_firms(db, days=2)

Authentication: NASA_FIRMS_MAP_KEY is read from the environment (local .env,
passed into the container via docker-compose env_file). The key is never
logged, never committed, never returned by the API.

Idempotent: detections upsert on the uq_detection constraint, so re-running
only adds genuinely new satellite passes. Events are rebuilt from the recent
window each refresh, so stale fires age out on their own.

Honesty: every refresh is logged to data_refreshes, and GET /data-status
exposes the exact fetch timestamp so the UI can say "updated from FIRMS"
with a real time — never "live".
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone

from geoalchemy2 import WKTElement
from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import DataRefresh, ThermalDetection, ThermalEvent
from app.services import firms_ingest
from app.services.event_engine import cluster_detections

log = logging.getLogger(__name__)

# Events are rebuilt from detections in this trailing window, so a refresh
# never resurfaces fires that stopped burning days ago.
CLUSTER_WINDOW_DAYS = 6


def _insert_detections(db: Session, detections: list[dict]) -> int:
    """Insert detections, skipping ones already stored. Returns # new rows."""
    if not detections:
        return 0
    before = db.query(func.count(ThermalDetection.id)).scalar() or 0
    values = [
        {
            "satellite": d["satellite"],
            "instrument": d["instrument"],
            "latitude": d["latitude"],
            "longitude": d["longitude"],
            "geom": WKTElement(f"POINT({d['longitude']} {d['latitude']})", srid=4326),
            "acquisition_date": d["acquisition_date"],
            "acquisition_time": d["acquisition_time"],
            "detection_timestamp": d["detection_timestamp"],
            "bright_ti4": d["bright_ti4"],
            "bright_ti5": d["bright_ti5"],
            "frp": d["frp"],
            "confidence": d["confidence"],
            "daynight": d["daynight"],
        }
        for d in detections
    ]
    stmt = pg_insert(ThermalDetection).values(values)
    stmt = stmt.on_conflict_do_nothing(constraint="uq_detection")
    db.execute(stmt)
    db.commit()
    after = db.query(func.count(ThermalDetection.id)).scalar() or 0
    return max(0, after - before)


def _recent_detection_dicts(db: Session, window_days: int) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    rows = (
        db.query(ThermalDetection)
        .filter(ThermalDetection.detection_timestamp >= cutoff)
        .all()
    )
    return [
        {
            "satellite": r.satellite,
            "instrument": r.instrument,
            "latitude": r.latitude,
            "longitude": r.longitude,
            "acquisition_date": (
                r.acquisition_date.isoformat()
                if hasattr(r.acquisition_date, "isoformat")
                else str(r.acquisition_date)
            ),
            "acquisition_time": r.acquisition_time,
            "detection_timestamp": r.detection_timestamp,
            "bright_ti4": r.bright_ti4,
            "bright_ti5": r.bright_ti5,
            "frp": r.frp,
            "confidence": r.confidence,
            "daynight": r.daynight,
            "id": r.id,
        }
        for r in rows
    ]


def _stable_event_code(first_detected, lat: float, lon: float) -> str:
    """Deterministic event code so the same physical event keeps its code
    across refreshes (bookmarks, flags, and open pages survive a refresh).

    Derived from the event's start date + centroid rounded to ~1 km, so small
    centroid shifts from new detections don't change the code.
    """
    day = first_detected.strftime("%Y%m%d")
    key = f"{lat:.2f},{lon:.2f},{day}"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:8].upper()
    return f"EVT-{day}-{digest}"


def _enrich_with_facilities(db: Session, lon: float, lat: float) -> dict:
    """Nearest facility + 1/5 km counts, via PostGIS geography."""
    point = "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography"
    nearest = db.execute(
        text(
            f"SELECT id, ST_Distance(geom::geography, {point}) AS dist_m "
            "FROM industrial_facilities "
            f"ORDER BY geom::geography <-> {point} LIMIT 1"
        ),
        {"lon": lon, "lat": lat},
    ).first()
    counts = db.execute(
        text(
            "SELECT "
            f"COUNT(*) FILTER (WHERE ST_DWithin(geom::geography, {point}, 1000)) AS n1, "
            f"COUNT(*) FILTER (WHERE ST_DWithin(geom::geography, {point}, 5000)) AS n5 "
            "FROM industrial_facilities"
        ),
        {"lon": lon, "lat": lat},
    ).first()
    return {
        "nearest_facility_id": nearest[0] if nearest else None,
        "facility_distance_m": round(float(nearest[1]), 1) if nearest else None,
        "facilities_within_1km": int(counts[0]) if counts else 0,
        "facilities_within_5km": int(counts[1]) if counts else 0,
    }


def refresh_from_firms(db: Session, days: int | None = None) -> dict:
    """Run a full FIRMS refresh. Returns a summary dict."""
    bbox, sources, env_days = firms_ingest.env_defaults()
    if days is None:
        days = env_days
    if not 1 <= days <= 5:
        raise ValueError("FIRMS day range must be 1-5")

    fetched_at = datetime.now(timezone.utc)

    # 1. Fetch + normalize from the FIRMS API (key from environment).
    detections = firms_ingest.fetch_india(days=days, sources=sources, bbox=bbox)
    log.info("refresh: fetched %d detections (%d-day window)", len(detections), days)

    # 2. Store new detections (idempotent).
    new_detections = _insert_detections(db, detections)

    # 3. Rebuild events from the recent window.
    recent = _recent_detection_dicts(db, CLUSTER_WINDOW_DAYS)
    events = cluster_detections(recent)
    log.info("refresh: clustered %d detections into %d events", len(recent), len(events))

    # 4. Replace the event set atomically. Codes are deterministic (start date
    #    + rounded centroid), so an ongoing event keeps its code across
    #    refreshes — bookmarks, flags, and open pages survive. Detections are
    #    re-linked to their new event rows (the ON DELETE SET NULL FK clears
    #    old links). Everything commits once at the end: the app never shows
    #    an empty event table mid-refresh, and a failed refresh rolls back to
    #    the previous events instead of leaving zero.
    db.query(ThermalEvent).delete()

    used_codes: set[str] = set()
    for ev in events:
        lon, lat = ev["centroid_lon"], ev["centroid_lat"]
        fac = _enrich_with_facilities(db, lon, lat)
        base_code = _stable_event_code(ev["first_detected"], lat, lon)
        code, suffix = base_code, 2
        while code in used_codes:
            code = f"{base_code}-{suffix}"
            suffix += 1
        used_codes.add(code)
        row = ThermalEvent(
            event_code=code,
            centroid_lat=lat,
            centroid_lon=lon,
            geom=WKTElement(f"POINT({lon} {lat})", srid=4326),
            first_detected=ev["first_detected"],
            last_detected=ev["last_detected"],
            duration_hours=ev.get("duration_hours", 0.0),
            detection_count=ev.get("detection_count", 1),
            max_frp=ev.get("max_frp"),
            mean_frp=ev.get("mean_frp"),
            total_frp=ev.get("total_frp"),
            max_brightness=ev.get("max_brightness"),
            mean_brightness=ev.get("mean_brightness"),
            satellites=ev.get("satellites", []),
            nearest_facility_id=fac["nearest_facility_id"],
            facility_distance_m=fac["facility_distance_m"],
            facilities_within_1km=fac["facilities_within_1km"],
            facilities_within_5km=fac["facilities_within_5km"],
        )
        db.add(row)
        db.flush()  # assign row.id so detections can link to it
        det_ids = [int(i) for i in (ev.get("detection_ids") or [])]
        if det_ids:
            db.query(ThermalDetection).filter(
                ThermalDetection.id.in_(det_ids)
            ).update({"event_id": row.id}, synchronize_session=False)
    db.commit()

    # 5. Log the refresh so the UI can show an exact "updated from FIRMS" time.
    db.add(
        DataRefresh(
            refreshed_at=fetched_at,
            source="FIRMS",
            days=days,
            detections_fetched=len(detections),
            detections_new=new_detections,
            events_built=len(events),
        )
    )
    db.commit()

    summary = {
        "fetched_at": fetched_at.isoformat(),
        "days": days,
        "detections_fetched": len(detections),
        "detections_new": new_detections,
        "detections_in_window": len(recent),
        "events_built": len(events),
    }
    log.info("refresh complete: %s", summary)
    return summary


if __name__ == "__main__":
    import argparse
    import sys

    sys.path.insert(0, "/srv/backend")
    from app.db import SessionLocal

    ap = argparse.ArgumentParser(description="Refresh TRACE data from the FIRMS API.")
    ap.add_argument("--days", type=int, default=2, help="FIRMS day range, 1-5")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO)
    db = SessionLocal()
    try:
        summary = refresh_from_firms(db, days=args.days)
        print(summary)
    finally:
        db.close()
