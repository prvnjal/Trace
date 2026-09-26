"""OSM land-use context for thermal events.

Reuses the proven Overpass machinery from backend/osm_landuse_extract.py
(per-bbox cached polygon fetch + point-in-polygon tagging) and exposes it as
a service the refresh pipeline can call.

Design notes:
- Never raises: any failure (Overpass down, timeout, parse error) degrades to
  "unknown" tags so a refresh never fails because of land-use lookup.
- The polygon cache lives at backend/data/landuse_cache (persisted via a
  docker volume), so repeated refreshes only query Overpass for genuinely new
  event locations.
- Event codes are deterministic, and refresh.py carries tags over by code —
  this function is only called for new codes.
"""
from __future__ import annotations

import importlib.util
import logging
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

log = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent  # backend/
_SCRIPT_PATH = _BACKEND_DIR / "osm_landuse_extract.py"

_mod = None


def _script():
    """Lazily load osm_landuse_extract.py as a module (it lives outside app/)."""
    global _mod
    if _mod is None:
        if str(_BACKEND_DIR) not in sys.path:
            # the script does `from targeted_osm_extract import ...`
            sys.path.insert(0, str(_BACKEND_DIR))
        spec = importlib.util.spec_from_file_location(
            "trace_osm_landuse_extract", _SCRIPT_PATH
        )
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load {_SCRIPT_PATH}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _mod = module
    return _mod


def _dedup_key(p: dict) -> tuple:
    b = p["bbox"]
    return (
        p["tag"],
        round(b[0], 5),
        round(b[1], 5),
        round(b[2], 5),
        round(b[3], 5),
    )


def _boxes_overlap(a: tuple, b: tuple, eps: float = 1e-9) -> bool:
    s1, w1, n1, e1 = a
    s2, w2, n2, e2 = b
    return s1 <= n2 + eps and s2 <= n1 + eps and w1 <= e2 + eps and w2 <= e1 + eps


def _unknown(ok: bool = False) -> dict:
    return {
        "landuse_class": "unknown",
        "landuse_tag": None,
        "inside": False,
        "distance_m": None,
        "ok": ok,
    }


def tag_centroids(points: list[tuple[float, float]]) -> list[dict]:
    """Tag (lat, lon) centroids with OSM land-use context.

    Returns a list aligned with ``points``; each entry:
        {"landuse_class": "farmland|forest|scrub_grass|industrial_urban|wetland|unknown",
         "landuse_tag": "landuse=farmland" | None,
         "inside": bool, "distance_m": float | None,
         "ok": bool}
    ``ok`` is True only when every Overpass query backing that point
    succeeded — a successful lookup with no matching polygon is a genuine
    "unknown" (not retried); a failed lookup is retried next refresh.
    """
    if not points:
        return []
    try:
        mod = _script()
        boxes = [
            (lat - mod.BUFFER_DEG, lon - mod.BUFFER_DEG,
             lat + mod.BUFFER_DEG, lon + mod.BUFFER_DEG)
            for lat, lon in points
        ]
        merged = mod.split_large(mod.merge_boxes(boxes))
        log.info("landuse: %d centroids -> %d merged query boxes", len(points), len(merged))

        polys: list[dict] = []
        seen: set[tuple] = set()
        failed_boxes: set[int] = set()  # 1-based merged-box indices (jobs)
        jobs = [(i, len(merged), box) for i, box in enumerate(merged, 1)]
        # 2 workers: public Overpass rate-limits aggressively; politeness
        # beats parallelism for the cold batch.
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(mod.query_box, j): j[0] for j in jobs}
            for fut in as_completed(futures):
                idx = futures[fut]
                _, box_polys = fut.result()
                if box_polys is None:
                    # Overpass failed for this box: polygons near it may be
                    # missing, so any point overlapping it is unverified and
                    # will be retried next refresh.
                    failed_boxes.add(idx)
                    continue
                if not box_polys:
                    # Query succeeded but found nothing: a genuine no-match
                    # for this box, not a failure. Do NOT mark it failed —
                    # points covered only by empty boxes stay verified.
                    continue
                for p in box_polys:
                    key = _dedup_key(p)
                    if key in seen:
                        continue
                    seen.add(key)
                    p["ring"] = [tuple(pt) for pt in p["ring"]]  # json -> tuples
                    p["bbox"] = tuple(p["bbox"])
                    polys.append(p)
        log.info("landuse: %d polygons for tagging (%d boxes failed)",
                 len(polys), len(failed_boxes))
        failed_merged = [merged[i - 1] for i in failed_boxes]
        tags = []
        for (lat, lon), pbox in zip(points, boxes):
            # A point is verified only if every merged box overlapping its own
            # buffer box returned successfully — otherwise polygons near it
            # may be missing and the tag must be retried, not trusted.
            ok = not any(_boxes_overlap(pbox, fb) for fb in failed_merged)
            t = mod.tag_event(lat, lon, polys)
            t["ok"] = ok
            tags.append(t)
        return tags
    except Exception:
        log.exception("landuse tagging failed; falling back to 'unknown'")
        return [_unknown() for _ in points]
