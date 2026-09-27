"""Dump per-event aggregate features for all current thermal events.

Writes ml_poc/outputs/ml_features.csv — a flat file, so the training set is
immune to the refresh pipeline reshuffling event codes.

Run from the project root:
    python ml_poc/features.py
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import connect, FEATURE_QUERY, derive_features, NUMERIC_COLS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "outputs", "ml_features.csv")


def main():
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(FEATURE_QUERY)
            cols = [d[0] for d in cur.description]
            events = [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()

    rows = []
    for ev in events:
        sats = ev.get("satellites") or []
        canon = {
            # days is rounded exactly like generate_labeling_sheet.py
            "days": round((ev.get("duration_hours") or 0) / 24, 1),
            "detections": ev.get("detection_count"),
            "n_satellites": len(sats),
            "max_frp": ev.get("max_frp"),
            "mean_frp": ev.get("mean_frp"),
            "day_dets": ev.get("day_dets"),
            "night_dets": ev.get("night_dets"),
            "facility_dist_km": (
                ev.get("facility_distance_m") / 1000
                if ev.get("facility_distance_m") is not None else None
            ),
            "facilities_1km": ev.get("facilities_within_1km"),
            "land_use": ev.get("landuse_class"),
        }
        feat = derive_features(canon)
        feat["event_code"] = ev["event_code"]
        rows.append(feat)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["event_code"] + NUMERIC_COLS + ["land_use"])
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {OUT}: {len(rows)} events.")


if __name__ == "__main__":
    main()
