# Industrial Thermal Intelligence Platform
## System Overview, Domain Context & Clean Rebuild Blueprint

Complete context transfer for the Industrial Thermal Intelligence Platform. Any AI agent or software engineer reading this will be able to fully comprehend the system's purpose, domain context, mathematical formulation, current technical debt, and exact specifications required to rebuild it cleanly from scratch.

## 1. Project Purpose & Core Problem

### 1.1 What the System Aims to Accomplish
The Industrial Thermal Intelligence Platform is an AI-enabled remote sensing and GIS decision-support system. It automatically ingests satellite thermal anomaly observations, clusters them into physical real-world thermal events, extracts geospatial and temporal context, classifies the source using machine learning, calculates an operational risk score, and presents the intelligence on an interactive geospatial command dashboard.

### 1.2 The Core Problem with Raw Satellite Data
Satellites such as NASA's VIIRS (on Suomi-NPP, NOAA-20, NOAA-21) and MODIS (on Terra and Aqua) detect mid-infrared and thermal-infrared radiation, publishing near-real-time thermal anomaly hotspots via the NASA FIRMS API.

However, a raw satellite detection provides only coordinates (lat, lon), Fire Radiative Power (FRP in MW), brightness temperature (K), and confidence. It cannot answer:

- Is this an accidental industrial fire, explosion, or chemical leak at a high-risk facility?
- Is this an authorized, routine operational gas flare at an oil refinery?
- Is this seasonal crop stubble burning in an agricultural field nearby?
- Is this an encroaching forest wildfire?
- Is this a persistent, recurring thermal source or an abrupt, single-pass emergency?

### 1.3 The Solution
The platform resolves this ambiguity by combining five data streams:

1. Satellite Thermal Radiometry: FRP, brightness temperatures (T4, T5), confidence, day/night flags.
2. Infrastructure GIS Registries: Proximity to refineries, petrochemical complexes, thermal power plants, steel mills, and LNG terminals.
3. Land Cover / Land Use: Surrounding ratios of industrial, built-up, forest, and agricultural terrain.
4. Spatio-Temporal Clustering & Persistence: Haversine DBSCAN grouping and historical recurrence frequency within 5 km.
5. AI Classification & Multi-Factor Risk Scoring: An XGBoost multi-class classifier paired with a weighted risk engine.

## 2. Technical Debt & Codebase Audit (What to Eliminate)

Current anti-pattern: NASA FIRMS -> DBSCAN -> CSV Files -> FastAPI reads CSVs -> UI with Fallback Data. (Database & ML Classifier are bypassed in the actual REST API runtime!)

### 2.1 Audit of Dead, Redundant, and Conflicting Code
- **Bypassed Database** (backend/main.py): Endpoints read flat CSV files (events.csv, event_features.csv, training_with_recurrence.csv) directly via csv.DictReader. The PostgreSQL/PostGIS database is never queried by the API! Fix: Connect FastAPI directly to PostGIS via SQLAlchemy 2.0 / AsyncPG with spatial GiST indexing.
- **Disconnected ML Model** (backend/ml/inference/predict.py): The trained model industrial_fire_classifier.joblib is an isolated CLI tool reading sys.stdin. The API never invokes it; /statistics hardcodes counts from static training CSVs. Fix: Load the model into FastAPI application state as an inference singleton and invoke it during event processing.
- **Conflicting SQL Schemas** (backend/database/schema.sql vs thermal_schema.sql): Two incompatible schemas for thermal_anomalies: one uses location GEOGRAPHY with acquisition_date, the other uses geometry GEOMETRY(Point, 4326) with bright_ti4. Fix: Establish a single authoritative, normalized PostGIS schema.
- **Hardcoded Paths & Orphan Scripts** (backend/feature_engineering/feature_engineering.py): Hardcoded path C:\Users\ssk12\OneDrive\Documents\GitHub\AthletiQ\... and duplicate recurrence logic already present in temporal.py. Fix: Delete feature_engineering.py. Place modular feature extraction under a clean service layer.
- **Project Name Leakage** (docker-compose.yml): Docker container is named container_name: athletiq (residual artifact from another project). Fix: Rename to thermal_postgis.
- **Duplicate Imports & Stub Modules** (build_features.py, landcover.py): build_features.py imports temporal twice consecutively. landcover.py is an empty stub returning all None. Fix: Remove duplicate imports; implement real land-cover extraction (e.g. from ESA WorldCover / Copernicus raster or spatial polygons).
- **Geographic Disconnect in Frontend** (frontend/src/services/api.ts, ThermalMap.tsx): Fallback mock coordinates and initial map center point to New Orleans / Louisiana (29.9511, -90.0715), while actual seed facilities and data are in India (28.x, 77.x). Fix: Dynamically center and fit map bounds to the active event bounding box.
- **Naive Frontend Marker Symbology** (frontend/src/components/ThermalMap.tsx): Color-codes markers purely based on if (detection_count > 10) red; else purple; else amber;, ignoring the actual AI prediction and risk score. Fix: Color markers strictly by predicted_class and risk level (CRITICAL, HIGH, MEDIUM, LOW).

## 3. End-to-End Clean Architecture

DATA SOURCES: NASA FIRMS API (VIIRS/MODIS) | Industrial Registry (Refineries, Plants, LNG) | Land-Cover Rasters (Copernicus/Sentinel)
  -> SPATIO-TEMPORAL EVENT ENGINE: Haversine DBSCAN (5.0 km), temporal window splitting (gap <= 24 hrs), centroid & convex hull
  -> FEATURE ENGINEERING PIPELINE: Thermal (mean/max FRP, brightness temp, confidence) | Spatial (distance to nearest facility, counts in 1km/5km) | Land Cover (industrial, built-up, forest, agriculture) | Temporal (duration, detection count, recurrence freq) | Persistence (PERSISTENT / RECURRING / TEMPORARY + score)
  -> AI/ML & RISK ENGINE: XGBoost classifier (softmax), classes: INDUSTRIAL_FIRE, GAS_FLARE, INDUSTRIAL_SOURCE, WILDFIRE, AGRICULTURAL_BURNING, UNKNOWN. Risk engine: 0-100 score (thermal, proximity, growth).
  -> POSTGRESQL + POSTGIS (16-3.4): industrial_facilities | thermal_detections | thermal_events | spatial GiST indexes
  -> FASTAPI REST API: GET /api/v1/events (filters, bbox) | GET /api/v1/events/{id} (forensic dossier) | GET /api/v1/facilities | GET /api/v1/analytics/summary | POST /api/v1/classify
  -> MODERN GIS DASHBOARD: MapLibre GL JS / Leaflet (Dark Matter base, sat toggle), classified marker symbology & 5km impact buffer rings, industrial facility overlays & spatial proximity lines, filterable event feed (risk, class, persistence), comprehensive event inspector (telemetry, gauges, radar).

## 4. Mathematical Formulations & Algorithms

### 4.1 Spatio-Temporal Clustering
- Earth radius R = 6371.0088 km. Distance threshold D_spatial = 5.0 km. Epsilon = 5.0/6371.0088 ≈ 0.0007848 rad.
- Run DBSCAN on radian coordinates with metric "haversine" and min_samples=1.
- Temporal windowing: within each spatial cluster sort detections chronologically; if (t_i - t_{i-1}) > 24 hours, partition into a new event.
- Centroid: lat_bar = mean(lat_i), lon_bar = mean(lon_i). Duration_hours = (t_max - t_min)/3600.

### 4.2 Proximity & Recurrence
- Distance to facility: great-circle distance via PostGIS ST_Distance(geom::geography) or Haversine.
- Recurrence(E_k) = sum over j != k of I(t_j < t_k AND Distance(E_j, E_k) <= 5.0 km).

### 4.3 Persistence Scoring
- PERSISTENT if N_det >= 5 and Delta_T_hours >= 24; RECURRING if N_det >= 3 or Recurrence >= 2; TEMPORARY otherwise.
- Score = min(S_count + S_duration + S_recurrence, 100); S_count = 30 (N>=5) or 15 (N>=3); S_duration = 40 (dT>=24) or 20 (dT>=12); S_recurrence = 30 (R>=5) or 15 (R>=2).

### 4.4 Multi-Factor Risk Score (0-100)
Risk Score = 0.30*I_thermal + 0.20*I_persistence + 0.25*I_proximity + 0.15*I_growth + 0.10*I_class
Levels: LOW (0-30), MEDIUM (31-60), HIGH (61-80), CRITICAL (81-100).

## 5. Authoritative Database Schema (PostgreSQL + PostGIS)

Single canonical schema replacing all legacy fragmented SQL files:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE industrial_facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    facility_type VARCHAR(100) NOT NULL,
    operator VARCHAR(255),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_facilities_geom ON industrial_facilities USING GIST(geom);

CREATE TABLE thermal_detections (
    id SERIAL PRIMARY KEY,
    satellite VARCHAR(50) NOT NULL,
    instrument VARCHAR(50) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL,
    acquisition_date DATE NOT NULL,
    acquisition_time VARCHAR(10) NOT NULL,
    detection_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    brightness_temperature DOUBLE PRECISION,
    background_temperature DOUBLE PRECISION,
    frp DOUBLE PRECISION NOT NULL,
    confidence VARCHAR(20) NOT NULL,
    daynight VARCHAR(10),
    event_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_detection UNIQUE (latitude, longitude, acquisition_date, acquisition_time, satellite)
);
CREATE INDEX idx_detections_geom ON thermal_detections USING GIST(geom);
CREATE INDEX idx_detections_timestamp ON thermal_detections(detection_timestamp);
CREATE INDEX idx_detections_event_id ON thermal_detections(event_id);

CREATE TABLE thermal_events (
    id SERIAL PRIMARY KEY,
    event_code VARCHAR(50) UNIQUE NOT NULL,
    centroid_lat DOUBLE PRECISION NOT NULL,
    centroid_lon DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL,
    first_detected TIMESTAMP WITH TIME ZONE NOT NULL,
    last_detected TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_hours DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    detection_count INTEGER NOT NULL DEFAULT 1,
    nearest_facility_id INTEGER REFERENCES industrial_facilities(id),
    facility_distance_m DOUBLE PRECISION,
    facilities_within_1km INTEGER DEFAULT 0,
    facilities_within_5km INTEGER DEFAULT 0,
    industrial_ratio DOUBLE PRECISION DEFAULT 0.0,
    builtup_ratio DOUBLE PRECISION DEFAULT 0.0,
    forest_ratio DOUBLE PRECISION DEFAULT 0.0,
    agriculture_ratio DOUBLE PRECISION DEFAULT 0.0,
    persistence_status VARCHAR(50) NOT NULL,
    persistence_score INTEGER NOT NULL DEFAULT 0,
    recurrence_frequency INTEGER NOT NULL DEFAULT 0,
    predicted_class VARCHAR(100) NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    probabilities_json JSONB,
    risk_score DOUBLE PRECISION NOT NULL,
    risk_level VARCHAR(30) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_events_geom ON thermal_events USING GIST(geom);
CREATE INDEX idx_events_predicted_class ON thermal_events(predicted_class);
CREATE INDEX idx_events_risk_level ON thermal_events(risk_level);
```

## 6. Machine Learning Feature Contract

Exact 11-dimensional feature vector:
- frp_mean (MW), frp_max (MW), confidence (0-1 normalized), facility_distance (m), facility_count (within 5km),
  industrial_ratio, forest_ratio, agriculture_ratio, builtup_ratio (fractions 0-1),
  detection_count, event_duration_hours.
Target classes: INDUSTRIAL_FIRE, GAS_FLARE, INDUSTRIAL_THERMAL_SOURCE, AGRICULTURAL_BURNING, WILDFIRE, UNKNOWN.

## 7. Clean Rebuild Roadmap

- Phase 1: docker-compose (postgis:16-3.4, container thermal_postgis), canonical schema.sql, seed.sql for target region.
- Phase 2: firms_ingest.py (VIIRS CSV from NASA FIRMS Area API), event_engine.py (Haversine DBSCAN eps=5km + 24hr temporal grouping), features.py (spatial distances, land cover ratios, persistence scores).
- Phase 3: train.py (XGBoost multi:softprob, stratified 80/20 split), save model package to ml/models/industrial_fire_classifier.joblib.
- Phase 4: FastAPI backend with ml_service.py (model loaded once at startup into app.state); endpoints: GET /api/v1/events (filters), GET /api/v1/events/{id}, GET /api/v1/facilities, GET /api/v1/analytics/summary, POST /api/v1/classify.
- Phase 5: React+TS+Vite+Tailwind dashboard: MapLibre/Leaflet map, automatic fitBounds, dark/satellite base toggle, classification-driven markers, facility overlays with 1km/5km rings, filterable event feed, event inspector drawer.

## 8. Verification & Acceptance Criteria
1. Zero dead code: no orphaned scripts, hardcoded Windows paths, or boilerplate container names.
2. Direct database integration: FastAPI queries PostGIS directly; no flat CSV reads in API handlers.
3. Integrated ML inference: predictions computed dynamically and written to event records.
4. Geographic alignment: frontend map, data, database, and satellite streams geographically synchronized.
5. Operational usability: operator can view active regional industrial fires ranked by risk, inspect nearby facilities and land-cover composition, and verify the AI model's reasoning.
