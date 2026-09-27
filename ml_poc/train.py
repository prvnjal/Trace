"""Train the PoC classifier on weak labels.

- Joins ml_weak_labels.csv with ml_features.csv.
- EXCLUDES any event that already has a human label (event_labels table),
  so the training set and the human evaluation set never overlap.
- Trains gradient boosting: XGBoost when installed, otherwise sklearn's
  HistGradientBoostingClassifier (both handle NaN natively).
- Balanced sample weights counter class imbalance.
- Saves ml_poc/outputs/model.pkl + train_report.json.

Run from the project root:  python ml_poc/train.py
"""
import csv
import json
import os
import pickle
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import connect, LABELS5, MODEL_VERSION, NUMERIC_COLS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "outputs")
FEAT_CSV = os.path.join(OUT_DIR, "ml_features.csv")
WEAK_CSV = os.path.join(OUT_DIR, "ml_weak_labels.csv")
MODEL_PKL = os.path.join(OUT_DIR, "model.pkl")
REPORT_JSON = os.path.join(OUT_DIR, "train_report.json")


def build_matrix(feat_rows, landuse_cats=None):
    import pandas as pd
    df = pd.DataFrame(feat_rows)
    X_num = df[NUMERIC_COLS].apply(pd.to_numeric, errors="coerce")
    dummies = pd.get_dummies(df["land_use"].fillna("unknown"), prefix="lu")
    if landuse_cats is None:
        landuse_cats = sorted(dummies.columns.tolist())
    dummies = dummies.reindex(columns=landuse_cats, fill_value=0)
    X = pd.concat([X_num, dummies], axis=1)
    return X, landuse_cats


def main():
    with open(FEAT_CSV, newline="", encoding="utf-8") as fh:
        feats = {r["event_code"]: r for r in csv.DictReader(fh)}
    with open(WEAK_CSV, newline="", encoding="utf-8") as fh:
        weak = [r for r in csv.DictReader(fh) if r["weak_label"]]

    # Keep train/eval disjoint: drop events carrying a human label.
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT event_code FROM event_labels")
            human_labeled = {r[0] for r in cur.fetchall()}
    finally:
        conn.close()

    train_rows, excluded = [], 0
    for w in weak:
        if w["event_code"] in human_labeled:
            excluded += 1
            continue
        f = feats.get(w["event_code"])
        if f is None:
            continue
        train_rows.append((f, w["weak_label"]))

    # XGBoost requires class labels 0..K-1 with no gaps. The human-label
    # exclusion above can wipe out a rare class entirely (e.g. the single
    # flare weak label). Remap to the classes actually present and warn
    # loudly — the model then cannot predict the missing class, which the
    # scorecard will show honestly instead of crashing here.
    present = sorted({lab for _, lab in train_rows}, key=LABELS5.index)
    missing = [lab for lab in LABELS5 if lab not in present]
    if missing:
        print(f"WARNING: no training examples for {missing}; "
              f"the model will never predict them.")
    if not present:
        sys.exit("ERROR: no training rows at all.")
    label2idx = {lab: i for i, lab in enumerate(present)}

    feat_rows = [f for f, _ in train_rows]
    y = [label2idx[lab] for _, lab in train_rows]
    X, landuse_cats = build_matrix(feat_rows)

    from sklearn.utils.class_weight import compute_sample_weight
    sample_weight = compute_sample_weight(class_weight="balanced", y=y)

    try:
        from xgboost import XGBClassifier
        model = XGBClassifier(
            n_estimators=400, max_depth=6, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
            random_state=42, n_jobs=-1, eval_metric="mlogloss",
        )
        flavor = "xgboost"
    except ImportError:
        from sklearn.ensemble import HistGradientBoostingClassifier
        model = HistGradientBoostingClassifier(
            max_iter=400, learning_rate=0.05, random_state=42)
        flavor = "sklearn-histgradientboosting"

    model.fit(X, y, sample_weight=sample_weight)

    bundle = {
        "model": model,
        "feature_cols": list(X.columns),
        "landuse_cats": landuse_cats,
        "classes": present,
        "version": MODEL_VERSION,
        "flavor": flavor,
    }
    with open(MODEL_PKL, "wb") as fh:
        pickle.dump(bundle, fh)

    from collections import Counter
    dist = Counter(lab for _, lab in train_rows)
    report = {
        "model_version": MODEL_VERSION,
        "flavor": flavor,
        "n_train": len(train_rows),
        "n_weak_total": len(weak),
        "n_excluded_human_labeled": excluded,
        "train_label_dist": {lab: dist.get(lab, 0) for lab in LABELS5},
        "classes_trained": present,
        "classes_missing": missing,
        "feature_cols": list(X.columns),
    }
    with open(REPORT_JSON, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    print(f"Trained {flavor} on {len(train_rows)} weak-labeled events "
          f"({excluded} human-labeled excluded).")
    for lab in LABELS5:
        print(f"  {lab:28s} {dist.get(lab, 0)}")
    print(f"Saved {MODEL_PKL}")


if __name__ == "__main__":
    main()
