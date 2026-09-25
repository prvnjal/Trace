# TRACE — Thermal Intelligence (clean rebuild)

India-wide thermal intelligence from real NASA FIRMS satellite data,
with OpenStreetMap industrial context. No synthetic labels, no
classification claims the data can't support.

## Data flow

```
FIRMS CSVs (VIIRS SNPP / NOAA-20 / MODIS)
  → backend/pipeline_run.py        normalize + dedupe → 1,868 detections
  → event_engine.cluster_detections → 708 thermal events (events_preview.json)
  → backend/osm_filter_pbf.py      Geofabrik India PBF → 14,963 facilities
  → backend/enrich_events.py       nearest facility + 1/5 km counts (events_enriched.json)
  → backend/app/load_db.py         → PostGIS (one-time seed)

# Automatic refresh — no more browser CSV downloads.
# Key lives in .env (gitignored, passed into the container via compose env_file).
NASA_FIRMS_MAP_KEY in .env
  → POST /admin/refresh            fetch FIRMS API → normalize → upsert detections
                                   → re-cluster 6-day window → enrich vs PostGIS
                                   facilities → rebuild events
  → automatic: every FIRMS_REFRESH_HOURS (default 6) while the API runs —
                                   first run ~2 min after boot, never overlapping
                                   a manual refresh
  → GET /admin/refresh/status      progress (running / done / failed)
  → GET /data-status               exact "updated from FIRMS" timestamp for the UI
  → backend/app/main.py            FastAPI (/events, /statistics, /facilities)
  → frontend/                      React + Leaflet dashboard
```

Proximity to a facility is **context, not causation** — the platform
reports distances and counts, never a fire classification.

## Run the demo (on your laptop)

Prerequisites: Docker Desktop.

```bash
# 1. PostGIS + API (schema auto-applies on first start)
docker compose up --build -d

# 2. Load facilities + events into the database (one time)
docker compose exec api python -m app.load_db

# 3. API docs
open http://localhost:8000/docs

# 4. Dashboard
cd frontend
npm install
npm run dev        # → http://localhost:5173 (set VITE_API_URL if the API isn't on localhost:8000)
```

Useful API calls:

```bash
curl localhost:8000/statistics
curl "localhost:8000/events?min_detections=10&sort=frp&limit=20"
curl localhost:8000/events/EVT-2026-000001
curl "localhost:8000/facilities?kind=power_plant&min_lon=72&min_lat=20&max_lon=73&max_lat=22"
```

## Refreshing the satellite data

1. Download fresh FIRMS CSVs (India bbox `68,6,97,37`) with your
   `NASA_FIRMS_MAP_KEY` in `backend/.env` (see `.env.example`).
2. `cd backend && python pipeline_run.py --csv <files...> --out events_preview.json`
3. `python enrich_events.py events_preview.json data/osm_facilities_india.geojson events_enriched.json`
4. `docker compose exec api python -m app.load_db --fresh`

## Repo layout

- `backend/app/` — FastAPI API, SQLAlchemy models, DB loader
- `backend/database/schema.sql` — canonical PostGIS schema
- `backend/data/osm_facilities_india.geojson` — cached OSM facilities (3.6 MB)
- `backend/events_enriched.json` — events with industrial context
- `frontend/` — React + Tailwind + Leaflet dashboard
- `PROJECT_SPECIFICATION.md` — full product/architecture spec
