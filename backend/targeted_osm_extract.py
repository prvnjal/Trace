#!/usr/bin/env python3
"""Targeted OSM industrial-facility extraction around thermal event locations.

Fallback for the slow full-India PBF scan: instead of scanning the whole
country, only query Overpass for bboxes buffered around the 708 clustered
event centroids, merged to keep the number of queries small.

Usage:
    python targeted_osm_extract.py [events_preview.json] [data/osm_facilities_targeted.geojson]

Facility definition (point-like industrial features):
  - power=plant            power stations            -> power_plant
  - man_made=works         factories / works         -> works
  - man_made=petroleum_well oil/gas wells            -> petroleum_well
  - industrial=* (nodes)   refineries etc.           -> industrial_site
NOTE: way["industrial"] is deliberately excluded -- it forces a full key
scan plus geometry fetch and reliably times out (see osm_extract.py).
"""
from __future__ import annotations

import json
import logging
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)

OVERPASS_URLS = [
    # overpass-api.de first: kumi mirror is currently timing out (2026-09-24).
    # Kept as a last-resort fallback.
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

INDIA_BBOX = (6.0, 68.0, 37.0, 97.0)  # south, west, north, east
BUFFER_DEG = 0.1          # ~11 km around each event centroid
MAX_BOX_AREA_DEG2 = 1.0   # split merged boxes bigger than this
PAUSE_S = 1.0             # politeness pause per worker between queries
WORKERS = 4               # parallel Overpass queries (keep modest)
CLIENT_TIMEOUT_S = 150    # client-side read timeout per request
QUERY_RETRIES = 4         # attempts per box (cycles through endpoints)

TAG_QUERIES = [
    'node["power"="plant"]',
    'way["power"="plant"]',
    'node["man_made"="works"]',
    'way["man_made"="works"]',
    'node["industrial"]',
    'node["man_made"="petroleum_well"]',
]


def build_query(s: float, w: float, n: float, e: float, timeout: int = 120) -> str:
    clauses = "\n  ".join(f"{t}({s},{w},{n},{e});" for t in TAG_QUERIES)
    return f"[out:json][timeout:{timeout}];\n(\n  {clauses}\n);\nout center tags;"


def post_query(query: str, retries: int = QUERY_RETRIES) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode()
    last_err: Exception | None = None
    for attempt in range(retries):
        for base in OVERPASS_URLS:
            req = urllib.request.Request(
                base, data=data,
                headers={"User-Agent": "trace-thermal-intel/0.1 (research demo)"},
            )
            try:
                with urllib.request.urlopen(req, timeout=CLIENT_TIMEOUT_S) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except Exception as exc:
                log.warning("overpass %s failed (attempt %d): %s",
                            base, attempt + 1, exc)
                last_err = exc
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"all overpass endpoints failed: {last_err}")


def query_box(args: tuple[int, int, tuple]) -> tuple[int, list[dict] | None]:
    """Query one merged bbox. Returns (index, features or None on failure)."""
    i, total, (s, w, n, e) = args
    try:
        result = post_query(build_query(s, w, n, e))
    except RuntimeError as exc:
        log.error("box %d/%d failed permanently: %s", i, total, exc)
        return i, None
    feats: list[dict] = []
    for el in result.get("elements", []):
        tags = el.get("tags", {})
        if el["type"] == "node":
            lat, lon = el.get("lat"), el.get("lon")
        else:
            center = el.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "name": tags.get("name"),
                "facility_type": facility_type(tags),
                "osm_type": el["type"],
                "osm_id": el["id"],
            },
        })
    time.sleep(PAUSE_S)
    return i, feats


def overlaps(a, b) -> bool:
    # boxes as (s, w, n, e)
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def merge_boxes(boxes: list[tuple]) -> list[tuple]:
    """Greedy merge of overlapping boxes until none overlap."""
    boxes = list(boxes)
    changed = True
    while changed:
        changed = False
        out = []
        used = [False] * len(boxes)
        for i in range(len(boxes)):
            if used[i]:
                continue
            cur = boxes[i]
            for j in range(i + 1, len(boxes)):
                if used[j]:
                    continue
                if overlaps(cur, boxes[j]):
                    o = boxes[j]
                    cur = (min(cur[0], o[0]), min(cur[1], o[1]),
                           max(cur[2], o[2]), max(cur[3], o[3]))
                    used[j] = True
                    changed = True
            out.append(cur)
            used[i] = True
        boxes = out
    return boxes


def split_large(boxes: list[tuple]) -> list[tuple]:
    """Recursively split boxes whose area exceeds MAX_BOX_AREA_DEG2."""
    result = []
    for (s, w, n, e) in boxes:
        area = (n - s) * (e - w)
        if area <= MAX_BOX_AREA_DEG2:
            result.append((s, w, n, e))
            continue
        # split along the longer axis
        if (n - s) >= (e - w):
            mid = (s + n) / 2
            result.extend(split_large([(s, w, mid, e), (mid, w, n, e)]))
        else:
            mid = (w + e) / 2
            result.extend(split_large([(s, w, n, mid), (s, mid, n, e)]))
    return result


def facility_type(tags: dict) -> str:
    if tags.get("power") == "plant":
        return "power_plant"
    if tags.get("man_made") == "petroleum_well":
        return "petroleum_well"
    if "industrial" in tags:
        return "industrial_site"
    if tags.get("man_made") == "works":
        return "works"
    return "other"


def main(events_path: str, out_path: str) -> None:
    events = json.loads(Path(events_path).read_text(encoding="utf-8"))
    log.info("loaded %d events", len(events))

    boxes = []
    for ev in events:
        lat, lon = ev["centroid_lat"], ev["centroid_lon"]
        boxes.append((lat - BUFFER_DEG, lon - BUFFER_DEG,
                      lat + BUFFER_DEG, lon + BUFFER_DEG))
    merged = split_large(merge_boxes(boxes))
    log.info("%d event bboxes -> %d merged query boxes", len(boxes), len(merged))

    from concurrent.futures import ThreadPoolExecutor, as_completed

    features: list[dict] = []
    seen: set[tuple] = set()  # (osm_type, osm_id)
    failed = 0
    done = 0
    jobs = [(i, len(merged), box) for i, box in enumerate(merged, 1)]
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(query_box, j): j[0] for j in jobs}
        for fut in as_completed(futures):
            i, feats = fut.result()
            done += 1
            if feats is None:
                failed += 1
            else:
                new = 0
                for f in feats:
                    key = (f["properties"]["osm_type"], f["properties"]["osm_id"])
                    if key in seen:
                        continue
                    seen.add(key)
                    features.append(f)
                    new += 1
                if done % 10 == 0 or done == len(merged):
                    log.info("progress %d/%d boxes, %d facilities so far",
                             done, len(merged), len(features))
    log.info("done: %d/%d boxes ok, %d facilities, %d failed boxes",
             len(merged) - failed, len(merged), len(features), failed)

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(
        {"type": "FeatureCollection", "features": features}, indent=1),
        encoding="utf-8")
    print(f"wrote {len(features)} facilities -> {out} (failed boxes: {failed})")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ev_path = sys.argv[1] if len(sys.argv) > 1 else "events_preview.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "data/osm_facilities_targeted.geojson"
    main(ev_path, out)
