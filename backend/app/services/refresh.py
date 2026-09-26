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
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from geoalchemy2 import WKTElement
from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import DataRefresh, RefreshEventSnapshot, ThermalDetection, ThermalEvent
from app.services import firms_ingest
from app.services.event_engine import cluster_detections
from app.services.landuse import tag_centroids

log = logging.getLogger(__name__)

# Events are rebuilt from detections in this trailing window, so a refresh
# never resurfaces fires that stopped burning days ago.
CLUSTER_WINDOW_DAYS = 6


def compute_event_tier(detection_count: int, facility_distance_m: float | None) -> str:
    n = detection_count
    d_km = facility_distance_m / 1000.0 if facility_distance_m is not None else None
    if n >= 25 and d_km is not None and d_km <= 5.0:
        return "CRITICAL"
    elif n >= 10 or (n >= 3 and d_km is not None and d_km <= 1.0):
        return "HIGH"
    elif n >= 3 or (d_km is not None and d_km <= 5.0):
        return "MEDIUM"
    return "LOW"


def ensure_initial_snapshot(db: Session) -> None:
    """If data_refreshes exists but no snapshot rows exist, create an initial snapshot
    from the current database state for the latest refresh row.
    """
    has_snaps = db.query(func.count(RefreshEventSnapshot.id)).scalar() or 0
    if has_snaps > 0:
        return
    latest_ref = db.query(DataRefresh).order_by(DataRefresh.id.desc()).first()
    if not latest_ref:
        return
    all_events = db.query(ThermalEvent).all()
    if not all_events:
        return
    snapshot_rows = []
    for ev in all_events:
        d_km = ev.facility_distance_m / 1000.0 if ev.facility_distance_m is not None else None
        tier = compute_event_tier(ev.detection_count, ev.facility_distance_m)
        snapshot_rows.append(
            RefreshEventSnapshot(
                refresh_id=latest_ref.id,
                event_code=ev.event_code,
                detection_count=ev.detection_count,
                max_frp=ev.max_frp,
                tier=tier,
                nearest_facility_km=round(d_km, 3) if d_km is not None else None,
            )
        )
    if snapshot_rows:
        db.add_all(snapshot_rows)
        db.commit()
        log.info("created initial snapshot for refresh %d (%d events)", latest_ref.id, len(snapshot_rows))


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


def refresh_from_firms(
    db: Session,
    days: int | None = None,
    progress: Callable[[str], None] | None = None,
) -> dict:
    """Run a full FIRMS refresh. Returns a summary dict.

    ``progress``, when given, is called with a short human-readable stage
    label as the refresh advances (surfaced via /admin/refresh/status).
    """
    def _stage(label: str) -> None:
        log.info("refresh stage: %s", label)
        if progress is not None:
            try:
                progress(label)
            except Exception:
                log.warning("refresh progress callback failed", exc_info=True)

    bbox, sources, env_days = firms_ingest.env_defaults()
    if days is None:
        days = env_days
    if not 1 <= days <= 5:
        raise ValueError("FIRMS day range must be 1-5")

    fetched_at = datetime.now(timezone.utc)

    # 1. Fetch + normalize from the FIRMS API (key from environment).
    _stage(f"fetching {days}-day FIRMS window")
    detections = firms_ingest.fetch_india(days=days, sources=sources, bbox=bbox)
    log.info("refresh: fetched %d detections (%d-day window)", len(detections), days)

    # 2. Store new detections (idempotent).
    _stage(f"storing {len(detections)} detections")
    new_detections = _insert_detections(db, detections)

    # 3. Rebuild events from the recent window.
    _stage("clustering detections into events")
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
    #
    #    Land-use carry-over: event codes are deterministic, so an event that
    #    survives across refreshes keeps its OSM land-use tag without another
    #    Overpass lookup. Only genuinely new codes — plus previously
    #    *unverified* unknowns (transient Overpass failures, not genuine
    #    no-matches) — are tagged (after commit, so a slow Overpass never
    #    holds the event table empty).
    prev_landuse = {
        code: (cls, tag, inside, dist, verified)
        for code, cls, tag, inside, dist, verified in db.query(
            ThermalEvent.event_code,
            ThermalEvent.landuse_class,
            ThermalEvent.landuse_tag,
            ThermalEvent.landuse_inside,
            ThermalEvent.landuse_distance_m,
            ThermalEvent.landuse_verified,
        ).all()
    }
    db.query(ThermalEvent).delete()

    used_codes: set[str] = set()
    needs_landuse: list[ThermalEvent] = []
    for ev in events:
        lon, lat = ev["centroid_lon"], ev["centroid_lat"]
        fac = _enrich_with_facilities(db, lon, lat)
        base_code = _stable_event_code(ev["first_detected"], lat, lon)
        code, suffix = base_code, 2
        while code in used_codes:
            code = f"{base_code}-{suffix}"
            suffix += 1
        used_codes.add(code)
        lu = prev_landuse.get(code)
        # A carried-over tag is final if it names a real class OR it is a
        # *verified* "unknown" (a successful lookup that genuinely found no
        # matching polygon — never re-queried). Only unverified unknowns
        # (transient Overpass failures) and codes with no tag at all are
        # looked up below; this is also what backfills pre-migration events.
        # Crucially, a verified unknown keeps its verified flag when carried
        # over — otherwise it would silently become retryable every refresh.
        lu_final = lu is not None and (
            (lu[0] or "unknown") != "unknown" or bool(lu[4])
        )
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
            landuse_class=lu[0] if lu_final else "unknown",
            landuse_tag=lu[1] if lu_final else None,
            landuse_inside=lu[2] if lu_final else None,
            landuse_distance_m=lu[3] if lu_final else None,
            landuse_verified=lu[4] if lu_final else None,
        )
        if not lu_final:
            needs_landuse.append(row)
        db.add(row)
        db.flush()  # assign row.id so detections can link to it
        det_ids = [int(i) for i in (ev.get("detection_ids") or [])]
        if det_ids:
            db.query(ThermalDetection).filter(
                ThermalDetection.id.in_(det_ids)
            ).update({"event_id": row.id}, synchronize_session=False)
    db.commit()

    # 4b. Tag genuinely new event codes (plus unverified unknowns from failed
    # Overpass lookups) with OSM land-use context. Runs after the commit above
    # so the event table is never left empty mid-refresh if Overpass is slow;
    # tag_centroids never raises (failures -> unverified "unknown", retried
    # next refresh; verified no-matches are left alone).
    if needs_landuse:
        _stage(f"tagging land cover for {len(needs_landuse)} events (OSM)")
        tags = tag_centroids([(r.centroid_lat, r.centroid_lon) for r in needs_landuse])
        for row, t in zip(needs_landuse, tags):
            row.landuse_class = t["landuse_class"]
            row.landuse_tag = t["landuse_tag"]
            row.landuse_inside = t["inside"]
            row.landuse_distance_m = t["distance_m"]
            row.landuse_verified = t["ok"]
        db.commit()
        log.info("refresh: land-use tagged %d new events", len(needs_landuse))

    # 5. Log the refresh so the UI can show an exact "updated from FIRMS" time, and snapshot events.
    _stage("finalizing refresh log")
    ref_row = DataRefresh(
        refreshed_at=fetched_at,
        source="FIRMS",
        days=days,
        detections_fetched=len(detections),
        detections_new=new_detections,
        events_built=len(events),
    )
    db.add(ref_row)
    db.flush()

    all_events = db.query(ThermalEvent).all()
    snapshot_rows = []
    for ev in all_events:
        d_km = ev.facility_distance_m / 1000.0 if ev.facility_distance_m is not None else None
        tier = compute_event_tier(ev.detection_count, ev.facility_distance_m)
        snapshot_rows.append(
            RefreshEventSnapshot(
                refresh_id=ref_row.id,
                event_code=ev.event_code,
                detection_count=ev.detection_count,
                max_frp=ev.max_frp,
                tier=tier,
                nearest_facility_km=round(d_km, 3) if d_km is not None else None,
            )
        )
    if snapshot_rows:
        db.add_all(snapshot_rows)
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
