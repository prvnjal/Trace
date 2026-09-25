#!/usr/bin/env python3
"""Load OSM facilities and clustered thermal events into PostGIS.

Usage:
    cd backend
    python -m app.load_db [--fresh]

Reads:
    data/osm_facilities_india.geojson   (from osm_filter_pbf.py)
    events_enriched.json                (from enrich_events.py)

Idempotent: skips loading a table that already has rows, unless --fresh
is passed (which truncates both tables first).

Detections (thermal_detections) are NOT loaded here: the raw FIRMS rows live
in the pipeline, not in events_enriched.json. The live pipeline writes them
directly via the models in app/models.py.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from geoalchemy2 import WKTElement
from sqlalchemy import func, select, text

from app.db import SessionLocal, engine
from app.models import Base, Facility, ThermalEvent

HERE = Path(__file__).resolve().parent.parent  # backend/


def parse_osm_id(raw: str | None) -> int | None:
    if not raw:
        return None
    m = re.search(r"(\d+)", str(raw))
    return int(m.group(1)) if m else None


def load_facilities(db, path: Path) -> int:
    fc = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for feat in fc["features"]:
        props = feat["properties"]
        lon, lat = feat["geometry"]["coordinates"]
        kind = props.get("kind") or "other"
        name = props.get("name") or f"{kind} #{props.get('osm_id', '?')}"
        rows.append(
            Facility(
                name=name,
                facility_type=kind,
                operator=props.get("operator"),
                osm_id=parse_osm_id(props.get("osm_id")),
                latitude=lat,
                longitude=lon,
                geom=WKTElement(f"POINT({lon} {lat})", srid=4326),
            )
        )
    db.add_all(rows)
    db.commit()
    return len(rows)


def nearest_facility_id(db, name: str | None, kind: str | None, lon: float, lat: float):
    """Resolve the enriched nearest-facility back to its DB row."""
    stmt = (
        select(Facility.id)
        .where(Facility.facility_type == kind)
        .order_by(
            Facility.geom.distance_centroid(
                WKTElement(f"POINT({lon} {lat})", srid=4326)
            )
        )
        .limit(1)
    )
    if name:
        stmt = stmt.where(Facility.name == name)
    return db.execute(stmt).scalar_one_or_none()


def load_events(db, path: Path) -> int:
    events = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for i, ev in enumerate(events, start=1):
        code = ev.get("event_code") or f"EVT-2026-{i:06d}"
        lon, lat = ev["centroid_lon"], ev["centroid_lat"]
        fid = nearest_facility_id(
            db, ev.get("nearest_facility_name"), ev.get("nearest_facility_type"), lon, lat
        )
        rows.append(
            ThermalEvent(
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
                nearest_facility_id=fid,
                facility_distance_m=ev.get("facility_distance_m"),
                facilities_within_1km=ev.get("facilities_within_1km", 0),
                facilities_within_5km=ev.get("facilities_within_5km", 0),
            )
        )
    db.add_all(rows)
    db.commit()
    return len(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="truncate tables before loading")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        if args.fresh:
            db.execute(text("TRUNCATE thermal_detections, thermal_events, industrial_facilities RESTART IDENTITY CASCADE"))
            db.commit()
            print("truncated tables")

        n_fac = db.query(func.count(Facility.id)).scalar()
        if n_fac == 0:
            n = load_facilities(db, HERE / "data" / "osm_facilities_india.geojson")
            print(f"loaded {n} facilities")
        else:
            print(f"facilities already loaded ({n_fac}), skipping")

        n_ev = db.query(func.count(ThermalEvent.id)).scalar()
        if n_ev == 0:
            n = load_events(db, HERE / "events_enriched.json")
            print(f"loaded {n} events")
        else:
            print(f"events already loaded ({n_ev}), skipping")
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
