#!/usr/bin/env python3
"""Extract industrial facility points for India from OpenStreetMap via Overpass.

Usage:
    python osm_extract.py [--test] [--out data/osm_facilities_india.geojson]

Queries are chunked over the India bbox to stay within Overpass timeouts,
with polite pauses between requests. Results are cached to GeoJSON so the
pipeline never queries Overpass twice for the same data.

Facility definition (point-like industrial features):
  - power=plant            power stations
  - man_made=works         factories / industrial works
  - industrial=*           refineries, smelters, etc. tagged directly
  - man_made=petroleum_well oil/gas wells (flare context)
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)

OVERPASS_URLS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

INDIA_BBOX = (6.0, 68.0, 37.0, 97.0)  # south, west, north, east

TAG_QUERIES = [
    'node["power"="plant"]',
    'way["power"="plant"]',
    'node["man_made"="works"]',
    'way["man_made"="works"]',
    'node["industrial"]',
    'node["man_made"="petroleum_well"]',
]
# NOTE: way["industrial"] (unqualified) is deliberately excluded: it forces a
# full key scan plus geometry fetch and reliably times out. Nodes with the
# industrial key are cheap and catch refineries/smelter tags.


def build_query(s: float, w: float, n: float, e: float, timeout: int = 120) -> str:
    clauses = "\n  ".join(f"{t}({s},{w},{n},{e});" for t in TAG_QUERIES)
    return f"[out:json][timeout:{timeout}];\n(\n  {clauses}\n);\nout center tags;"


def post_query(query: str, timeout: int = 300, retries: int = 3) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode()
    last_err: Exception | None = None
    for attempt in range(retries):
        for base in OVERPASS_URLS:
            req = urllib.request.Request(
                base, data=data,
                headers={"User-Agent": "trace-thermal-intel/0.1 (research demo)"},
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except Exception as exc:  # try the mirror before failing
                log.warning("overpass %s failed (attempt %d): %s",
                            base, attempt + 1, exc)
                last_err = exc
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"all overpass endpoints failed: {last_err}")


def feature_from_element(el: dict) -> dict | None:
    tags = el.get("tags", {})
    if el["type"] == "node":
        lat, lon = el.get("lat"), el.get("lon")
    else:
        center = el.get("center") or {}
        lat, lon = center.get("lat"), center.get("lon")
    if lat is None or lon is None:
        return None
    if "power" in tags and tags["power"] == "plant":
        ftype = "power_plant"
    elif tags.get("man_made") == "petroleum_well":
        ftype = "petroleum_well"
    elif "industrial" in tags:
        ftype = tags["industrial"]
    elif tags.get("man_made") == "works":
        ftype = "works"
    else:
        ftype = "other"
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "name": tags.get("name"),
            "facility_type": ftype,
            "operator": tags.get("operator"),
            "osm_type": el["type"],
            "osm_id": el["id"],
        },
    }


def extract(bbox: tuple[float, float, float, float],
            chunks: tuple[int, int] = (3, 2),
            pause_s: float = 2.0) -> list[dict]:
    s, w, n, e = bbox
    rows, cols = chunks
    features: list[dict] = []
    seen: set[tuple] = set()
    total = rows * cols
    done = 0
    for r in range(rows):
        for c in range(cols):
            cs = s + (n - s) * r / rows
            cn = s + (n - s) * (r + 1) / rows
            cw = w + (e - w) * c / cols
            ce = w + (e - w) * (c + 1) / cols
            done += 1
            log.info("chunk %d/%d bbox %.2f,%.2f,%.2f,%.2f", done, total, cs, cw, cn, ce)
            result = post_query(build_query(cs, cw, cn, ce))
            new = 0
            for el in result.get("elements", []):
                feat = feature_from_element(el)
                if not feat:
                    continue
                lon, lat = feat["geometry"]["coordinates"]
                key = (round(lat, 4), round(lon, 4), feat["properties"]["facility_type"])
                if key in seen:
                    continue
                seen.add(key)
                features.append(feat)
                new += 1
            log.info("chunk %d/%d: +%d facilities (%d total)", done, total, new, len(features))
            if done < total:
                time.sleep(pause_s)
    return features


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true",
                        help="run on a small Gujarat bbox only")
    parser.add_argument("--out", default="data/osm_facilities_india.geojson")
    parser.add_argument("--chunks", default="3,2",
                        help="rows,cols to split the bbox into")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.test:
        bbox = (20.5, 72.0, 21.8, 73.2)  # Gujarat industrial belt
        chunks = (1, 1)
        out = Path("data/osm_facilities_test.geojson")
    else:
        bbox = INDIA_BBOX
        chunks = tuple(int(x) for x in args.chunks.split(","))
        out = Path(args.out)

    features = extract(bbox, chunks=chunks)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(
        {"type": "FeatureCollection", "features": features}, indent=1),
        encoding="utf-8")
    print(f"wrote {len(features)} facilities -> {out}")


if __name__ == "__main__":
    sys.exit(main())
