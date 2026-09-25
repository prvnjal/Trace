-- Canonical PostGIS schema for the Industrial Thermal Intelligence Platform.
-- Single authoritative schema: GEOMETRY(Point, 4326) everywhere, GiST indexes.
-- Replaces the legacy fragmented schema.sql / thermal_schema.sql / events_schema.sql.
--
-- Table order matters: thermal_detections references thermal_events, and
-- thermal_events references industrial_facilities, so create parents first.

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Monitored industrial facilities (seeded from OpenStreetMap)
CREATE TABLE IF NOT EXISTS industrial_facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    facility_type VARCHAR(100) NOT NULL,   -- refinery, power_plant, steel, chemical, lng, cement, other
    operator VARCHAR(255),
    osm_id BIGINT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_facilities_geom ON industrial_facilities USING GIST (geom);

-- 2. Clustered physical thermal events (one row = one real-world event)
CREATE TABLE IF NOT EXISTS thermal_events (
    id SERIAL PRIMARY KEY,
    event_code VARCHAR(50) UNIQUE NOT NULL,   -- e.g. EVT-2026-000123
    centroid_lat DOUBLE PRECISION NOT NULL,
    centroid_lon DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL,
    first_detected TIMESTAMPTZ NOT NULL,
    last_detected TIMESTAMPTZ NOT NULL,
    duration_hours DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    detection_count INTEGER NOT NULL DEFAULT 1,
    -- thermal aggregates over the event's detections (matches event_engine output)
    max_frp DOUBLE PRECISION,
    mean_frp DOUBLE PRECISION,
    total_frp DOUBLE PRECISION,
    max_brightness DOUBLE PRECISION,
    mean_brightness DOUBLE PRECISION,
    satellites TEXT[] NOT NULL DEFAULT '{}',
    -- industrial / land-use context (populated by later enrichment stages)
    nearest_facility_id INTEGER REFERENCES industrial_facilities (id),
    facility_distance_m DOUBLE PRECISION,
    facilities_within_1km INTEGER NOT NULL DEFAULT 0,
    facilities_within_5km INTEGER NOT NULL DEFAULT 0,
    industrial_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    builtup_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    forest_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    agriculture_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    -- classification + risk (populated by later stages; UNKNOWN until labeled)
    persistence_status VARCHAR(50),           -- PERSISTENT / RECURRING / TEMPORARY
    persistence_score INTEGER NOT NULL DEFAULT 0,
    recurrence_frequency INTEGER NOT NULL DEFAULT 0,
    predicted_class VARCHAR(100) NOT NULL DEFAULT 'UNKNOWN',
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    probabilities_json JSONB,
    risk_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    risk_level VARCHAR(30) NOT NULL DEFAULT 'UNASSESSED',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_geom ON thermal_events USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_events_predicted_class ON thermal_events (predicted_class);
CREATE INDEX IF NOT EXISTS idx_events_risk_level ON thermal_events (risk_level);
CREATE INDEX IF NOT EXISTS idx_events_last_detected ON thermal_events (last_detected);

-- 3. Raw satellite thermal detections (NASA FIRMS VIIRS/MODIS; INSAT later)
CREATE TABLE IF NOT EXISTS thermal_detections (
    id SERIAL PRIMARY KEY,
    satellite VARCHAR(50) NOT NULL,        -- e.g. VIIRS_SNPP_NRT, MODIS_NRT
    instrument VARCHAR(50) NOT NULL,       -- VIIRS, MODIS
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL,
    acquisition_date DATE NOT NULL,
    acquisition_time VARCHAR(10) NOT NULL, -- HHMM as published by FIRMS
    detection_timestamp TIMESTAMPTZ NOT NULL,
    bright_ti4 DOUBLE PRECISION,
    bright_ti5 DOUBLE PRECISION,
    frp DOUBLE PRECISION NOT NULL,
    confidence VARCHAR(20) NOT NULL,       -- l / n / h as published
    daynight VARCHAR(10),
    event_id INTEGER REFERENCES thermal_events (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_detection UNIQUE (latitude, longitude, acquisition_date, acquisition_time, satellite)
);
CREATE INDEX IF NOT EXISTS idx_detections_geom ON thermal_detections USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_detections_timestamp ON thermal_detections (detection_timestamp);
CREATE INDEX IF NOT EXISTS idx_detections_event_id ON thermal_detections (event_id);

-- Log of automatic FIRMS refreshes (written by the refresh service).
CREATE TABLE IF NOT EXISTS data_refreshes (
    id SERIAL PRIMARY KEY,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(20) NOT NULL DEFAULT 'FIRMS',
    days INTEGER NOT NULL,
    detections_fetched INTEGER NOT NULL,
    detections_new INTEGER NOT NULL,
    events_built INTEGER NOT NULL
);
