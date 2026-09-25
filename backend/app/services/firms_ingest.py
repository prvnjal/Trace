"""NASA FIRMS ingestion: fetch active-fire CSVs and normalize to detection records.

Authentication: reads NASA_FIRMS_MAP_KEY from the environment (local .env on
the operator's machine). Never hardcode the key, never log it.

Uses the current official FIRMS Area API shape (verified 2026-09-24):
    https://firms.modaps.eosdis.nasa.gov/api/area/csv/[MAP_KEY]/[SOURCE]/[AREA]/[DAYS]
Day range is 1-5. Reference: https://firms.modaps.eosdis.nasa.gov/api/area/
"""
from __future__ import annotations

import csv
import io
import logging
import os
import urllib.request
from datetime import datetime, timezone

log = logging.getLogger(__name__)

HOST = "firms.modaps.eosdis.nasa.gov"

INDIA_BBOX = (68.0, 6.0, 97.0, 37.0)  # west, south, east, north
DEFAULT_SOURCES = ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "MODIS_NRT")
DEFAULT_DAYS = 2


def env_defaults() -> tuple[tuple[float, float, float, float], tuple[str, ...], int]:
    """bbox, sources, days — hardcoded defaults overridable via environment.

    NASA_FIRMS_BBOX:    "west,south,east,north", e.g. "68,6,97,37"
    NASA_FIRMS_SOURCES: comma-separated FIRMS source names
    NASA_FIRMS_DAY_RANGE: 1-5
    """
    bbox = INDIA_BBOX
    raw_bbox = os.environ.get("NASA_FIRMS_BBOX", "").strip()
    if raw_bbox:
        parts = tuple(float(p) for p in raw_bbox.split(","))
        if len(parts) == 4:
            bbox = parts  # type: ignore[assignment]

    sources = DEFAULT_SOURCES
    raw_sources = os.environ.get("NASA_FIRMS_SOURCES", "").strip()
    if raw_sources:
        parsed = tuple(s.strip() for s in raw_sources.split(",") if s.strip())
        if parsed:
            sources = parsed

    days = DEFAULT_DAYS
    raw_days = os.environ.get("NASA_FIRMS_DAY_RANGE", "").strip()
    if raw_days.isdigit() and 1 <= int(raw_days) <= 5:
        days = int(raw_days)

    return bbox, sources, days


def _map_key() -> str:
    key = os.environ.get("NASA_FIRMS_MAP_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "NASA_FIRMS_MAP_KEY is not set. Put it in the local .env file; "
            "never paste it into chat or commit it."
        )
    return key


def _area_url(source: str, area: str, days: int) -> str:
    if not 1 <= days <= 5:
        raise ValueError("FIRMS day range must be 1-5")
    return (
        f"https://{HOST}/api/area/csv/{_map_key()}/"
        f"{source}/{area}/{days}"
    )


def fetch_source(source: str, bbox: tuple[float, float, float, float],
                 days: int = 2) -> list[dict]:
    """Fetch one FIRMS source for a bbox. Returns list of raw CSV dicts."""
    area = ",".join(str(v) for v in bbox)
    url = _area_url(source, area, days)
    req = urllib.request.Request(url, headers={"User-Agent": "trace-thermal-intel/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            body = resp.read()
    except Exception as exc:
        log.error("FIRMS request failed for %s: %s", source, exc)
        raise
    text = body.decode("utf-8", errors="replace")
    if not text.strip() or text.lstrip().startswith("<"):
        raise RuntimeError(f"FIRMS returned non-CSV response for {source}: {text[:200]}")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    log.info("FIRMS %s: %d rows for bbox %s", source, len(rows), area)
    return rows


def normalize_row(row: dict, source: str) -> dict | None:
    """Map a FIRMS CSV row onto the thermal_detections schema. None if unusable.

    VIIRS rows carry bright_ti4/bright_ti5; MODIS rows carry brightness/bright_t31.
    Both are mapped onto the same bright_ti4/bright_ti5 fields so downstream
    brightness statistics are instrument-consistent.
    """
    try:
        lat = float(row["latitude"])
        lon = float(row["longitude"])
        frp = float(row.get("frp", 0) or 0)
        acq_date = row["acq_date"]          # YYYY-MM-DD
        acq_time = row["acq_time"]          # HHMM
        dt = datetime.strptime(f"{acq_date} {acq_time}", "%Y-%m-%d %H%M").replace(
            tzinfo=timezone.utc)
    except (KeyError, ValueError, TypeError):
        return None
    instrument = "VIIRS" if "VIIRS" in source else ("MODIS" if "MODIS" in source else source)
    return {
        "satellite": source,
        "instrument": instrument,
        "latitude": lat,
        "longitude": lon,
        "acquisition_date": acq_date,
        "acquisition_time": acq_time,
        "detection_timestamp": dt,
        "bright_ti4": _f(row.get("bright_ti4", row.get("brightness"))),
        "bright_ti5": _f(row.get("bright_ti5", row.get("bright_t31"))),
        "frp": frp,
        "confidence": (row.get("confidence") or "").strip().lower(),
        "daynight": (row.get("daynight") or "").strip().upper() or None,
    }


def _f(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_india(days: int = 2,
                sources: tuple[str, ...] = DEFAULT_SOURCES,
                bbox: tuple[float, float, float, float] = INDIA_BBOX) -> list[dict]:
    """Fetch + normalize all configured sources for the India bbox."""
    detections: list[dict] = []
    for source in sources:
        for row in fetch_source(source, bbox, days):
            norm = normalize_row(row, source)
            if norm:
                detections.append(norm)
    # de-duplicate on the DB unique constraint fields
    seen: set[tuple] = set()
    unique: list[dict] = []
    for det in detections:
        key = (det["latitude"], det["longitude"], det["acquisition_date"],
               det["acquisition_time"], det["satellite"])
        if key not in seen:
            seen.add(key)
            unique.append(det)
    log.info("normalized %d unique detections", len(unique))
    return unique
