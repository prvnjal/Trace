#!/usr/bin/env python3
"""Cross-match thermal events against OSM industrial facilities.

Usage:
    python enrich_events.py [events_preview.json] [osm_facilities.geojson] [events_enriched.json]

For each event computes:
  - nearest facility (name, type, distance in metres)
  - number of facilities within 1 km and 5 km
Writes the enriched event list to JSON.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(lat1, lon1, lats, lons) -> np.ndarray:
    """Vectorized haversine distance in metres from one point to arrays."""
    p1 = np.radians(lat1)
    p2 = np.radians(lats)
    dphi = np.radians(lats - lat1)
    dlmb = np.radians(lons - lon1)
    a = np.sin(dphi / 2.0) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlmb / 2.0) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(a))


def main(events_path: str, facilities_path: str, out_path: str) -> None:
    events = json.loads(Path(events_path).read_text(encoding="utf-8"))
    fc = json.loads(Path(facilities_path).read_text(encoding="utf-8"))
    feats = fc["features"]
    print(f"events: {len(events)} | facilities: {len(feats)}")

    flat = np.array([f["geometry"]["coordinates"][::-1] for f in feats])  # lat, lon
    flat_lats, flat_lons = flat[:, 0], flat[:, 1]

    for ev in events:
        d = haversine_m(ev["centroid_lat"], ev["centroid_lon"], flat_lats, flat_lons)
        nearest_idx = int(np.argmin(d))
        nearest = feats[nearest_idx]["properties"]
        ev["nearest_facility_name"] = nearest.get("name")
        ev["nearest_facility_type"] = nearest.get("kind")
        ev["facility_distance_m"] = round(float(d[nearest_idx]), 1)
        ev["facilities_within_1km"] = int(np.sum(d <= 1000))
        ev["facilities_within_5km"] = int(np.sum(d <= 5000))

    Path(out_path).write_text(json.dumps(events, indent=1), encoding="utf-8")
    print(f"wrote {out_path}")

    dists = np.array([e["facility_distance_m"] for e in events])
    print(f"nearest-facility distance: median {np.median(dists)/1000:.1f} km | "
          f"mean {np.mean(dists)/1000:.1f} km")
    for radius_km, label in ((1, "1km"), (5, "5km")):
        n = sum(1 for e in events if e["facility_distance_m"] <= radius_km * 1000)
        print(f"events within {label} of a facility: {n}/{len(events)} ({100*n/len(events):.1f}%)")


if __name__ == "__main__":
    args = sys.argv[1:]
    ev_path = args[0] if len(args) > 0 else "events_preview.json"
    fac_path = args[1] if len(args) > 1 else "data/osm_facilities_india.geojson"
    out = args[2] if len(args) > 2 else "events_enriched.json"
    main(ev_path, fac_path, out)
