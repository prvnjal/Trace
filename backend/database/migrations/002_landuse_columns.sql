-- 002_landuse_columns.sql — one-time migration for existing databases.
--
-- Adds the OSM land-use context columns to thermal_events. Safe to run
-- multiple times (IF NOT EXISTS). Run once inside the postgis container:
--
--   docker compose exec postgis psql -U thermal -d thermal_intel \
--     -f /docker-entrypoint-initdb.d/002_landuse_columns.sql
--
-- (or copy the file in first: docker compose cp ... postgis:/tmp/...)
-- Fresh installs don't need this: backend/database/schema.sql already
-- includes the columns.

ALTER TABLE thermal_events
    ADD COLUMN IF NOT EXISTS landuse_class VARCHAR(30) NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS landuse_tag VARCHAR(60),
    ADD COLUMN IF NOT EXISTS landuse_inside BOOLEAN,
    ADD COLUMN IF NOT EXISTS landuse_distance_m DOUBLE PRECISION;
