"""One-command TRACE ML PoC.

Runs, in order:
  1. features    - dump per-event aggregates for current events (flat file)
  2. weak_labels - heuristic weak labels for training (flat file)
  3. train       - gradient boosting on weak labels -> model.pkl
  4. evaluate    - score the model on the 107 human-labeled workbook rows
  5. predict     - score current events -> ml_predictions.csv

Usage (from the project root):
    python ml_poc/run_all.py [--xlsx TRACE_labeling_filled.xlsx] [--no-predict]

Prerequisites: pip install -r ml_poc/requirements.txt
               $env:POSTGRES_PASSWORD set (see README_ML_POC.md)
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.join(HERE, "..")

STEPS = ["features", "weak_labels", "train", "evaluate", "predict"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", default="TRACE_labeling_filled.xlsx",
                    help="labeling workbook (default: TRACE_labeling_filled.xlsx)")
    ap.add_argument("--no-predict", action="store_true",
                    help="skip the final prediction step")
    args = ap.parse_args()

    for step in STEPS:
        if step == "predict" and args.no_predict:
            continue
        cmd = [sys.executable, os.path.join(HERE, f"{step}.py")]
        if step == "evaluate":
            cmd.append(args.xlsx)
        print(f"\n{'=' * 64}\nSTEP: {step}\n{'=' * 64}")
        r = subprocess.run(cmd, cwd=PROJECT_ROOT)
        if r.returncode != 0:
            sys.exit(f"\nFAILED at step '{step}'. Fix the error above and re-run.")

    print("\n" + "=" * 64)
    print("ML PoC complete.")
    print("  features / weak labels : ml_poc/outputs/ml_features.csv, ml_weak_labels.csv")
    print("  trained model          : ml_poc/outputs/model.pkl")
    print("  scorecard              : ml_poc/outputs/scorecard.txt (+ eval_report.json)")
    print("  current-event scores   : ml_poc/outputs/ml_predictions.csv")
    print("=" * 64)


if __name__ == "__main__":
    main()
