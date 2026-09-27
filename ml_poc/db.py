"""Shared helpers for the TRACE ML PoC (ml_poc/).

Feature definitions here are identical to labeling-kit/generate_labeling_sheet.py
so training features (from PostGIS) and evaluation features (from the labeling
workbook) live in exactly the same feature space.
"""
import os
import sys

# The five trainable classes. NEEDS_REVIEW is the human "I can't tell" bucket:
# it is excluded from training and from scoring (counted separately).
LABELS5 = [
    "ROUTINE_FLARE",
    "PERSISTENT_THERMAL_SOURCE",
    "CANDIDATE_INDUSTRIAL_FIRE",
    "LIKELY_WILDFIRE",
    "LIKELY_AG_BURNING",
]

MODEL_VERSION = "ml-poc-1"

NUMERIC_COLS = [
    "days", "detections", "n_satellites",
    "max_frp", "mean_frp", "frp_ratio",
    "day_dets", "night_dets", "night_frac",
    "det_per_day", "facility_dist_km", "facilities_1km",
]

# Same aggregates as generate_labeling_sheet.py, but for EVERY current event
# (no LIMIT, no already-labeled filter).
FEATURE_QUERY = """
SELECT e.event_code, e.centroid_lat, e.centroid_lon,
       e.first_detected::date AS first_d, e.last_detected::date AS last_d,
       e.duration_hours, e.detection_count,
       e.max_frp, e.mean_frp, e.satellites,
       e.facility_distance_m, e.facilities_within_1km,
       e.landuse_class,
       COALESCE(d.day_dets, 0)   AS day_dets,
       COALESCE(d.night_dets, 0) AS night_dets
FROM thermal_events e
LEFT JOIN (
    SELECT event_id,
           COUNT(*) FILTER (WHERE upper(daynight) = 'D') AS day_dets,
           COUNT(*) FILTER (WHERE upper(daynight) = 'N') AS night_dets
    FROM thermal_detections
    GROUP BY event_id
) d ON d.event_id = e.id
"""


def load_dotenv(path=".env"):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def connect():
    try:
        import psycopg2
    except ImportError:
        sys.exit("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
    load_dotenv(".env")
    password = os.environ.get("POSTGRES_PASSWORD", "")
    if not password:
        sys.exit(
            "ERROR: POSTGRES_PASSWORD not set. In PowerShell run:\n"
            "  $env:POSTGRES_PASSWORD = "
            "(docker compose exec -T postgis printenv POSTGRES_PASSWORD).Trim()"
        )
    return psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        dbname=os.environ.get("POSTGRES_DB", "thermal_intel"),
        user=os.environ.get("POSTGRES_USER", "thermal"),
        password=password,
    )


def derive_features(row):
    """Canonical derived features. `row` uses canonical keys:
    days, detections, n_satellites, max_frp, mean_frp, day_dets, night_dets,
    facility_dist_km, facilities_1km, land_use. Missing values stay None
    (become NaN in the frame; both supported boosters handle NaN natively)."""
    max_frp = row.get("max_frp")
    mean_frp = row.get("mean_frp")
    day_dets = row.get("day_dets") or 0
    night_dets = row.get("night_dets") or 0
    days = row.get("days")
    dets = row.get("detections")
    total_dn = day_dets + night_dets
    fac1km = row.get("facilities_1km")
    return {
        "days": days,
        "detections": dets,
        "n_satellites": row.get("n_satellites"),
        "max_frp": max_frp,
        "mean_frp": mean_frp,
        "frp_ratio": (max_frp / mean_frp) if mean_frp else None,
        "day_dets": day_dets,
        "night_dets": night_dets,
        "night_frac": (night_dets / total_dn) if total_dn > 0 else None,
        "det_per_day": (dets / max(days, 1.0))
        if (dets is not None and days is not None) else None,
        "facility_dist_km": row.get("facility_dist_km"),
        "facilities_1km": fac1km if fac1km is not None else 0,
        "land_use": row.get("land_use") or "unknown",
    }
