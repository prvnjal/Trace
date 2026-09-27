# TRACE labeling kit

Everything the team needs to produce the ML evaluation labels.

## Files

- `generate_labeling_sheet.py` — pulls priority events from your PostGIS DB
  and writes `TRACE_labeling.xlsx`: 5 batch sheets x 30 events, prefilled
  evidence columns, an EO Browser photo link per event, a dropdown label
  column, and a "Label guide" quick-reference sheet.
- `import_labels.py` — reads the filled workbook back and upserts every
  labeled row into `event_labels`.
- `004_event_labels.sql` — creates the `event_labels` table. Labels live
  here (not in `thermal_events`) so they survive refreshes: `event_code`
  is deterministic across refreshes.

## Flow (PowerShell, from the project root)

```powershell
# 0. Unzip this kit into the project folder, then:
pip install openpyxl psycopg2-binary

# 1. Create the labels table (once)
Get-Content labeling-kit\004_event_labels.sql | docker compose exec -T postgis psql -U thermal -d thermal_intel

# 2. Generate the workbook (150 priority events, multi-detection first)
python labeling-kit\generate_labeling_sheet.py --events 150 --per-batch 30 --out TRACE_labeling.xlsx
```

Send each teammate their batch sheet (Batch 1..5) plus the playbook PDF.
They fill the `label` dropdown and optional `notes`, then send the file back.

```powershell
# 3. Import the filled workbook (put real names here)
python labeling-kit\import_labels.py TRACE_labeling_filled.xlsx --by "Batch 1=Aarav;Batch 2=Diya;Batch 3=Ishaan;Batch 4=Meera;Batch 5=Kabir"

# 4. Sanity check
docker compose exec postgis psql -U thermal -d thermal_intel -c "SELECT label, COUNT(*) FROM event_labels GROUP BY label ORDER BY 2 DESC;"
```

Re-running the generator later skips events that already have a label.

## What the labelers see per event

event_code, lat/lon, first/last detected dates, days burning, detection
count, satellites, max & mean FRP (MW), day/night detection split,
nearest facility (name, type, distance), facility count within 1 km,
OSM land use, and a clickable satellite-photo link. They choose one of:
ROUTINE_FLARE, PERSISTENT_THERMAL_SOURCE, CANDIDATE_INDUSTRIAL_FIRE,
LIKELY_WILDFIRE, LIKELY_AG_BURNING, NEEDS_REVIEW.
