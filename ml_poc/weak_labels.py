"""Heuristic weak labels for training. Transparent rules, fully auditable.

Reads ml_poc/outputs/ml_features.csv and writes ml_weak_labels.csv with
(event_code, weak_label, rule). Events matching no rule are ABSTAINED from
(left out of training) rather than force-labeled.

These are NOT ground truth — they are noisy training signal. The 107
human-labeled workbook rows are the evaluation set. The two roles never mix:
we train on weak labels, we score on human labels.

Thresholds were calibrated on UNLABELLED feature distributions only (never
tuned to the human labels). The flare threshold is adaptive: it is the 90th
percentile of max FRP among persistent-ish industrial events in the current
data, so it self-calibrates instead of relying on a magic number. The
ind_lowconf rule is a deliberate broad prior — ordinary industrial heat that
matches no spike rule is most often routine operations; the evaluation
scorecard measures whether the model refines that prior.
"""
import csv
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import NUMERIC_COLS  # noqa: F401  (documents the feature contract)

HERE = os.path.dirname(os.path.abspath(__file__))
IN_CSV = os.path.join(HERE, "outputs", "ml_features.csv")
OUT_CSV = os.path.join(HERE, "outputs", "ml_weak_labels.csv")


def fnum(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def flare_threshold(rows):
    """80th percentile of max FRP among persistent-ish industrial events.

    Routine flares are among the hottest continuous industrial sources, so
    the top quintile is our flare prior. Adaptive: no magic number.
    """
    vals = sorted(
        fnum(r["max_frp"]) for r in rows
        if (r.get("land_use") or "").strip() == "industrial_urban"
        and (fnum(r["days"]) or 0) >= 2
        and fnum(r["max_frp"]) is not None
    )
    if not vals:
        return 15.0
    return vals[min(len(vals) - 1, int(0.8 * len(vals)))]


def weak_label(r, flare_frp):
    lu = (r.get("land_use") or "unknown").strip()
    days = fnum(r.get("days"))
    dets = fnum(r.get("detections"))
    nf = fnum(r.get("night_frac"))
    maxf = fnum(r.get("max_frp"))
    ratio = fnum(r.get("frp_ratio"))

    # --- stubble / field burning: farmland, brief, mostly daytime ---
    if lu == "farmland" and days is not None and days <= 2.5 \
            and nf is not None and nf <= 0.25:
        return "LIKELY_AG_BURNING", "ag_day_brief"
    if lu == "farmland" and days is not None and days <= 4:
        return "LIKELY_AG_BURNING", "ag_brief"

    # --- vegetation fire: forest/scrub, multi-day or intense ---
    if lu in ("forest", "scrub_grass") and days is not None and days >= 1.0 \
            and dets is not None and dets >= 4:
        return "LIKELY_WILDFIRE", "veg_multiday"
    if lu in ("forest", "scrub_grass", "wetland") \
            and maxf is not None and maxf >= 8:
        return "LIKELY_WILDFIRE", "veg_intense"

    # --- candidate industrial fire: sudden heat spike at industry ---
    if lu == "industrial_urban" and ratio is not None and ratio >= 3.0 \
            and days is not None and days <= 3:
        return "CANDIDATE_INDUSTRIAL_FIRE", "ind_spike"
    if lu == "industrial_urban" and days is not None and days <= 2 \
            and maxf is not None and maxf >= 8:
        return "CANDIDATE_INDUSTRIAL_FIRE", "ind_new_hot"

    # --- routine flare: hottest decile of persistent industrial heat ---
    # (checked before the generic persistent rules below)
    if lu == "industrial_urban" and days is not None and days >= 2 \
            and maxf is not None and maxf >= flare_frp:
        return "ROUTINE_FLARE", "flare_hot_decile"

    # --- persistent thermal source: steady industrial heat ---
    if lu == "industrial_urban" and days is not None and days >= 3 \
            and dets is not None and dets >= 8:
        return "PERSISTENT_THERMAL_SOURCE", "ind_persistent"
    if lu == "industrial_urban" and dets is not None and dets >= 8:
        return "PERSISTENT_THERMAL_SOURCE", "ind_many_dets"
    # Broad prior, fires last: ordinary industrial heat matching no spike
    # rule is most often routine operations, not an incident.
    if lu == "industrial_urban" and (
            (dets is not None and dets >= 3)
            or (days is not None and days >= 1.0)):
        return "PERSISTENT_THERMAL_SOURCE", "ind_lowconf"

    return None, "abstain"


def main():
    with open(IN_CSV, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    thr = flare_threshold(rows)
    print(f"flare FRP threshold (p90 of persistent industrial): {thr:.2f} MW")

    out, rule_counts, label_counts = [], Counter(), Counter()
    for r in rows:
        label, rule = weak_label(r, thr)
        rule_counts[rule] += 1
        if label:
            label_counts[label] += 1
            out.append({"event_code": r["event_code"],
                        "weak_label": label, "rule": rule})

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["event_code", "weak_label", "rule"])
        w.writeheader()
        w.writerows(out)

    print(f"Weak-labeled {len(out)}/{len(rows)} events "
          f"({rule_counts['abstain']} abstained).")
    print("By label:")
    for lab, n in label_counts.most_common():
        print(f"  {lab:28s} {n}")
    print("By rule:")
    for rule, n in rule_counts.most_common():
        print(f"  {rule:22s} {n}")


if __name__ == "__main__":
    main()
