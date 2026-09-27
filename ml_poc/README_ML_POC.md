# TRACE ML PoC — weak-supervision classifier

Trains a thermal-event classifier **without needing thousands of hand labels**:
heuristics generate noisy *training* labels at scale, and the 107 analyst-labeled
events from the labeling workbook serve as the *evaluation* set. The two roles
never mix — we train on weak labels, we score on human labels.

## Pipeline

```
PostGIS thermal_events ──► features.py ──► ml_features.csv      (flat file)
                                            ──► weak_labels.py ──► ml_weak_labels.csv
                                                                   ──► train.py ──► model.pkl
TRACE_labeling_filled.xlsx (150 rows, 107 usable) ──► evaluate.py ──► scorecard.txt
model.pkl + current events ──► predict.py ──► ml_predictions.csv
```

Everything lands in `ml_poc/outputs/` as flat files, so the refresh pipeline
reshuffling event codes cannot invalidate the training set or the scorecard.

## Run it

From the project root (where `docker-compose.yml` lives):

```powershell
$env:POSTGRES_PASSWORD = (docker compose exec -T postgis printenv POSTGRES_PASSWORD).Trim()
pip install -r ml_poc/requirements.txt
python ml_poc/run_all.py
```

`run_all.py` expects `TRACE_labeling_filled.xlsx` in the project root
(pass `--xlsx <path>` otherwise). Steps can also run individually, e.g.
`python ml_poc/predict.py --to-db` to upsert predictions into the
`ml_predictions` table.

If XGBoost isn't installable, training falls back to sklearn's
`HistGradientBoostingClassifier` automatically.

## The weak-label rules (auditable, in `weak_labels.py`)

| rule | fires when | label |
|---|---|---|
| `ag_day_brief` | farmland, ≤2.5 days, ≤25% night | LIKELY_AG_BURNING |
| `ag_brief` | farmland, ≤4 days | LIKELY_AG_BURNING |
| `veg_multiday` | forest/scrub, ≥1 day, ≥4 detections | LIKELY_WILDFIRE |
| `veg_intense` | forest/scrub/wetland, max FRP ≥ 8 | LIKELY_WILDFIRE |
| `ind_spike` | industrial, FRP max/mean ≥ 3, ≤3 days | CANDIDATE_INDUSTRIAL_FIRE |
| `ind_new_hot` | industrial, ≤2 days, max FRP ≥ 8 | CANDIDATE_INDUSTRIAL_FIRE |
| `flare_hot_decile` | industrial, ≥2 days, max FRP ≥ p80 of persistent industrial | ROUTINE_FLARE |
| `ind_persistent` / `ind_many_dets` | industrial, multi-day / many detections | PERSISTENT_THERMAL_SOURCE |
| `ind_lowconf` | industrial, ≥4 detections or ≥1.5 days, matched nothing above | PERSISTENT_THERMAL_SOURCE |

No rule → the event is **abstained from**, not force-labeled. Thresholds were
calibrated on *unlabelled* feature distributions only (never tuned to the
human labels); the flare threshold is adaptive (80th percentile), not a magic
number.

Coverage vs precision is the core tradeoff: strict rules give clean but tiny
training sets (early version: 121/1225 events, zero flares). `ind_lowconf` is
a deliberate broad prior — most ordinary industrial heat is routine
operations — and the scorecard measures whether the model refines it.

## Reading the scorecard (`outputs/scorecard.txt`)

- **Accuracy vs baseline** — the baseline always predicts the most common
  weak-label class. The model must beat it to prove it learned anything.
- **Macro F1** — the headline number: averages F1 across classes, so the rare
  classes (flare, candidate fire) count as much as the common ones.
- **Per-class precision/recall** — expect the small classes to be noisy.
- **Confusion matrix** — rows are the analyst's label, columns the model's
  prediction. Off-diagonal clusters tell you which categories the model
  confuses (e.g. flare vs persistent heat — expected without Nightfire data).
- **Weak-vs-human agreement** — how often the raw heuristics agreed with
  analysts on events carrying both. A diagnostic of heuristic quality, not a
  model score. The model should beat this number: that's the value of learning.

## Honest limitations (say these out loud in the demo)

1. **Weak labels are noisy by design.** The scorecard measures the model
   against 107 human labels — the heuristics themselves are never presented
   as truth.
2. **Small classes, noisy estimates.** ROUTINE_FLARE has ~5 eval examples;
   its recall is a rough indication, not a measurement.
3. **No Nightfire yet.** Separating routine flares from persistent industrial
   heat is the weakest distinction until the VIIRS Nightfire license lands.
4. **Point-in-time evaluation.** Event codes churn across refreshes, so the
   scorecard is computed on the frozen workbook, not the live event table.
5. **Labels are analyst interpretations**, not independently confirmed
   causes. Proximity to an industrial facility is context for analysts, not
   evidence of what caused the thermal event.

## What's next (not in this PoC)

- Wire `ml_predictions` into the event dossier ("Model: X (72%)").
- Add Nightfire-derived features (flare temperature persistence) when licensed.
- Replace heuristics with the growing human-labeled set as it accumulates.
- Stabilise event identity across refreshes (overlap-based tracking).
