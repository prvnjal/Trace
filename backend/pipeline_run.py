#!/usr/bin/env python3
"""End-to-end dev pipeline: FIRMS CSVs -> normalized detections -> events.

Usage:
    python pipeline_run.py firms_viirs_snpp_nrt_india.csv firms_viirs_noaa20_nrt_india.csv firms_modis_nrt_india.csv

Source is inferred from the filename (viirs_snpp_nrt / viirs_noaa20_nrt / modis_nrt).
Writes events to events_preview.json in the current directory.
"""
import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "app" / "services"))
from firms_ingest import normalize_row  # noqa: E402
from event_engine import cluster_detections  # noqa: E402

SOURCE_PATTERNS = [
    ("VIIRS_NOAA20_NRT", re.compile(r"noaa20", re.I)),
    ("VIIRS_SNPP_NRT", re.compile(r"snpp", re.I)),
    ("MODIS_NRT", re.compile(r"modis", re.I)),
]


def infer_source(filename: str) -> str:
    for source, pattern in SOURCE_PATTERNS:
        if pattern.search(filename):
            return source
    raise ValueError(f"cannot infer FIRMS source from filename: {filename}")


def main(paths: list[str]) -> None:
    detections: list[dict] = []
    for path in paths:
        source = infer_source(Path(path).name)
        with open(path, newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        kept = 0
        for row in rows:
            norm = normalize_row(row, source)
            if norm:
                detections.append(norm)
                kept += 1
        print(f"{source}: {len(rows)} rows -> {kept} normalized")

    # de-duplicate on (lat, lon, date, time, satellite)
    seen, unique = set(), []
    for det in detections:
        key = (det["latitude"], det["longitude"], det["acquisition_date"],
               det["acquisition_time"], det["satellite"])
        if key not in seen:
            seen.add(key)
            unique.append(det)
    print(f"total unique detections: {len(unique)}")

    events = cluster_detections(unique)
    print(f"total events: {len(events)}")
    counts = {}
    for ev in events:
        counts[ev["detection_count"]] = counts.get(ev["detection_count"], 0) + 1
    single = counts.get(1, 0)
    print(f"single-detection events: {single} | multi-detection events: {len(events) - single}")

    serializable = []
    for ev in events:
        ev = dict(ev)
        ev["first_detected"] = ev["first_detected"].isoformat()
        ev["last_detected"] = ev["last_detected"].isoformat()
        serializable.append(ev)
    with open("events_preview.json", "w", encoding="utf-8") as fh:
        json.dump(serializable, fh, indent=1)
    print("wrote events_preview.json")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: pipeline_run.py <firms csv> [<firms csv> ...]")
    main(sys.argv[1:])
