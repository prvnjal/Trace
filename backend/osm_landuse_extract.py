#!/usr/bin/env python3
"""Land-use context for thermal events via targeted Overpass queries.

For each of the 708 clustered events, fetch OSM land-use / natural polygons
in a small buffered bbox, then tag the event with the containing polygon's
class (smallest-area wins) or the nearest polygon within the buffer.

Why targeted queries instead of a full-PBF scan: land-use polygons are
millions of ways; resolving their node geometry needs far more RAM than the
facility point extract. Small per-area Overpass queries are the reliable
regime (the full-India chunked extract is what timed out).

Results are cached per merged bbox in data/landuse_cache/ so reruns and
retries are cheap.

Usage:
    .venv/bin/python osm_landuse_extract.py [events_enriched.json] [data/events_landuse.json]

Output: JSON list in the same order as the input events; each entry:
    {"landuse_class": "farmland|forest|scrub_grass|industrial_urban|wetland|unknown",
     "landuse_tag": "landuse=farmland",
     "inside": true|false,          # event centroid inside the polygon
     "distance_m": 0.0}             # 0 when inside, else distance to nearest edge
"""
from __future__ import annotations

import json
import logging
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from targeted_osm_extract import merge_boxes, post_query, split_large

log = logging.getLogger(__name__)

BUFFER_DEG = 0.05   # ~5.5 km around each event centroid
MAX_BOX_AREA_DEG2 = 0.25
PAUSE_S = 1.0
WORKERS = 4
CACHE_DIR = Path("data/landuse_cache")

LANDUSE_VALUES = ("farmland|farmyard|orchard|plantation|allotments|meadow|"
                  "grass|forest|industrial|commercial|residential|retail|"
                  "quarry|landfill|construction")
NATURAL_VALUES = "wood|scrub|heath|grassland|wetland"

CLASS_OF = {
    "landuse=farmland": "farmland", "landuse=farmyard": "farmland",
    "landuse=orchard": "farmland", "landuse=plantation": "farmland",
    "landuse=allotments": "farmland", "landuse=meadow": "farmland",
    "landuse=grass": "scrub_grass",
    "landuse=forest": "forest", "natural=wood": "forest",
    "natural=scrub": "scrub_grass", "natural=heath": "scrub_grass",
    "natural=grassland": "scrub_grass",
    "landuse=industrial": "industrial_urban",
    "landuse=commercial": "industrial_urban",
    "landuse=residential": "industrial_urban",
    "landuse=retail": "industrial_urban",
    "landuse=quarry": "industrial_urban",
    "landuse=landfill": "industrial_urban",
    "landuse=construction": "industrial_urban",
    "natural=wetland": "wetland",
}


def build_query(s: float, w: float, n: float, e: float, timeout: int = 180) -> str:
    return (
        f"[out:json][timeout:{timeout}];\n(\n"
        f'  way["landuse"~"^({LANDUSE_VALUES})$"]({s},{w},{n},{e});\n'
        f'  way["natural"~"^({NATURAL_VALUES})$"]({s},{w},{n},{e});\n'
        f'  relation["landuse"~"^({LANDUSE_VALUES})$"]({s},{w},{n},{e});\n'
        f'  relation["natural"~"^({NATURAL_VALUES})$"]({s},{w},{n},{e});\n'
        ");\nout geom tags;"
    )


def ring_area_deg2(ring) -> float:
    a = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def point_in_ring(lon: float, lat: float, ring) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_seg_dist_m(lon, lat, ax, ay, bx, by) -> float:
    """Distance from point to segment, equirectangular metres."""
    kx = 111320.0 * math.cos(math.radians(lat))
    px, py = lon * kx, lat * 110540.0
    ax, ay = ax * kx, ay * 110540.0
    bx, by = bx * kx, by * 110540.0
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def ring_dist_m(lon, lat, ring) -> float:
    best = float("inf")
    n = len(ring)
    for i in range(n):
        ax, ay = ring[i]
        bx, by = ring[(i + 1) % n]
        d = point_seg_dist_m(lon, lat, ax, ay, bx, by)
        if d < best:
            best = d
    return best


def classify(tags: dict) -> tuple[str, str] | tuple[None, None]:
    for key in ("landuse", "natural"):
        v = tags.get(key)
        if v:
            tag = f"{key}={v}"
            cls = CLASS_OF.get(tag)
            if cls:
                return cls, tag
    return None, None


def extract_polys(elements: list[dict]) -> list[dict]:
    """Turn Overpass elements (out geom) into polygon dicts."""
    polys = []
    seen: set[tuple] = set()
    for el in elements:
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        tags = el.get("tags", {})
        cls, tag = classify(tags)
        if not cls:
            continue
        rings: list[list[tuple]] = []
        if el["type"] == "way":
            geom = el.get("geometry") or []
            pts = [(g["lon"], g["lat"]) for g in geom]
            if len(pts) >= 4 and pts[0] == pts[-1]:
                rings.append(pts)
        elif el["type"] == "relation":
            for m in el.get("members", []):
                if m.get("type") != "way" or m.get("role") != "outer":
                    continue
                geom = m.get("geometry") or []
                pts = [(g["lon"], g["lat"]) for g in geom]
                if len(pts) >= 4 and pts[0] == pts[-1]:
                    rings.append(pts)
        for ring in rings:
            lons = [p[0] for p in ring]
            lats = [p[1] for p in ring]
            polys.append({
                "class": cls, "tag": tag,
                "ring": ring,
                "bbox": (min(lats), min(lons), max(lats), max(lons)),
                "area": ring_area_deg2(ring),
            })
    return polys


def query_box(args) -> tuple[int, list[dict] | None]:
    i, total, (s, w, n, e) = args
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"box_{s:.3f}_{w:.3f}_{n:.3f}_{e:.3f}.json".replace("-", "m")
    if cache_file.exists():
        try:
            return i, json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            pass  # corrupt cache -> requery
    try:
        result = post_query(build_query(s, w, n, e))
    except RuntimeError as exc:
        log.error("box %d/%d failed permanently: %s", i, total, exc)
        return i, None
    polys = extract_polys(result.get("elements", []))
    # cache the light form (drop ring coords? no - needed later; keep)
    cache_file.write_text(json.dumps(polys), encoding="utf-8")
    time.sleep(PAUSE_S)
    return i, polys


def tag_event(lat: float, lon: float, polys: list[dict]) -> dict:
    containing = []
    nearest = None
    nearest_d = float("inf")
    for p in polys:
        s, w, n, e = p["bbox"]
        # quick reject: event more than ~0.02 deg outside bbox (margin for edge dist)
        if lat < s - 0.02 or lat > n + 0.02 or lon < w - 0.02 or lon > e + 0.02:
            continue
        ring = p["ring"]
        if s <= lat <= n and w <= lon <= e and point_in_ring(lon, lat, ring):
            containing.append(p)
        else:
            d = ring_dist_m(lon, lat, ring)
            if d < nearest_d:
                nearest_d = d
                nearest = p
    if containing:
        best = min(containing, key=lambda p: p["area"])
        return {"landuse_class": best["class"], "landuse_tag": best["tag"],
                "inside": True, "distance_m": 0.0}
    if nearest is not None and nearest_d <= BUFFER_DEG * 111320.0 * 1.5:
        return {"landuse_class": nearest["class"], "landuse_tag": nearest["tag"],
                "inside": False, "distance_m": round(nearest_d, 1)}
    return {"landuse_class": "unknown", "landuse_tag": None,
            "inside": False, "distance_m": None}


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

    polys: list[dict] = []
    seen: set[tuple] = set()
    failed = 0
    done = 0
    jobs = [(i, len(merged), box) for i, box in enumerate(merged, 1)]
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(query_box, j): j[0] for j in jobs}
        for fut in as_completed(futures):
            i, box_polys = fut.result()
            done += 1
            if box_polys is None:
                failed += 1
            else:
                for p in box_polys:
                    key = (p["tag"], round(p["bbox"][0], 5), round(p["bbox"][1], 5),
                           round(p["bbox"][2], 5), round(p["bbox"][3], 5))
                    if key in seen:
                        continue
                    seen.add(key)
                    # restore ring tuples (json gives lists)
                    p["ring"] = [tuple(pt) for pt in p["ring"]]
                    p["bbox"] = tuple(p["bbox"])
                    polys.append(p)
            if done % 25 == 0 or done == len(merged):
                log.info("progress %d/%d boxes, %d polygons so far",
                         done, len(merged), len(polys))
    log.info("polygons: %d (failed boxes: %d)", len(polys), failed)

    results = []
    counts: dict[str, int] = {}
    for ev in events:
        r = tag_event(ev["centroid_lat"], ev["centroid_lon"], polys)
        results.append(r)
        counts[r["landuse_class"]] = counts.get(r["landuse_class"], 0) + 1
    log.info("land-use classes: %s", counts)

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(f"wrote {len(results)} event land-use tags -> {out}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ev_path = sys.argv[1] if len(sys.argv) > 1 else "events_enriched.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "data/events_landuse.json"
    main(ev_path, out)
