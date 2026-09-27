"""Score current events with the trained model.

Writes ml_poc/outputs/ml_predictions.csv:
    event_code, predicted_label, proba_<label>..., model_version
With --to-db, also upserts the predictions into the ml_predictions table
(useful once the refresh schedule is frozen; event codes churn otherwise).

Run from the project root:
    python ml_poc/predict.py [--to-db]
"""
import csv
import json
import os
import pickle
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import connect, FEATURE_QUERY, derive_features, NUMERIC_COLS, LABELS5, MODEL_VERSION

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "outputs")
MODEL_PKL = os.path.join(OUT_DIR, "model.pkl")
PRED_CSV = os.path.join(OUT_DIR, "ml_predictions.csv")


def fetch_current_features():
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
    return rows


def main():
    to_db = "--to-db" in sys.argv
    with open(MODEL_PKL, "rb") as fh:
        bundle = pickle.load(fh)
    model = bundle["model"]

    import pandas as pd
    rows = fetch_current_features()
    df = pd.DataFrame(rows)
    X_num = df[NUMERIC_COLS].apply(pd.to_numeric, errors="coerce")
    dummies = pd.get_dummies(df["land_use"].fillna("unknown"), prefix="lu")
    dummies = dummies.reindex(columns=bundle["landuse_cats"], fill_value=0)
    X = pd.concat([X_num, dummies], axis=1).reindex(
        columns=bundle["feature_cols"], fill_value=0)

    proba = model.predict_proba(X)
    pred_idx = proba.argmax(axis=1)

    out_rows = []
    for r, pi, pr in zip(rows, pred_idx, proba):
        out = {"event_code": r["event_code"],
               "predicted_label": bundle["classes"][pi],
               "model_version": bundle["version"]}
        for j, lab in enumerate(bundle["classes"]):
            out[f"proba_{lab}"] = round(float(pr[j]), 4)
        out_rows.append(out)

    with open(PRED_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    print(f"Scored {len(out_rows)} events -> {PRED_CSV}")

    from collections import Counter
    for lab, n in Counter(r["predicted_label"] for r in out_rows).most_common():
        print(f"  {lab:28s} {n}")

    if to_db:
        conn = connect()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS ml_predictions (
                        event_code    TEXT PRIMARY KEY,
                        predicted_label TEXT NOT NULL,
                        proba_json    JSONB NOT NULL,
                        model_version TEXT NOT NULL,
                        predicted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """)
                for r in out_rows:
                    pj = {lab: r[f"proba_{lab}"] for lab in bundle["classes"]}
                    cur.execute("""
                        INSERT INTO ml_predictions
                            (event_code, predicted_label, proba_json, model_version)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (event_code) DO UPDATE SET
                            predicted_label = EXCLUDED.predicted_label,
                            proba_json      = EXCLUDED.proba_json,
                            model_version   = EXCLUDED.model_version,
                            predicted_at    = NOW()
                    """, (r["event_code"], r["predicted_label"],
                          json.dumps(pj), r["model_version"]))
            conn.commit()
        finally:
            conn.close()
        print(f"Upserted {len(out_rows)} predictions into ml_predictions.")


if __name__ == "__main__":
    main()
