-- 004_event_labels.sql
-- Reviewed labels for the ML classifier.
--
-- event_code is deterministic across refreshes (start date + rounded
-- location), so labels in this table SURVIVE the refresh pipeline even
-- though thermal_events rows get rebuilt. Never store reviewed labels in
-- thermal_events itself.
--
-- This table is HUMAN-reviewed labels only: the honest evaluation set.
-- Machine-guessed (weak) labels live in the training pipeline, never here.
--
-- Apply once:
--   Get-Content labeling-kit\004_event_labels.sql | docker compose exec -T postgis psql -U thermal -d thermal_intel

CREATE TABLE IF NOT EXISTS event_labels (
    id SERIAL PRIMARY KEY,
    event_code VARCHAR(50) NOT NULL
        REFERENCES thermal_events (event_code) ON DELETE CASCADE,
    label VARCHAR(40) NOT NULL,
    labeled_by VARCHAR(100),
    notes TEXT,
    labeled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_code, labeled_by)
);

CREATE INDEX IF NOT EXISTS idx_event_labels_code
    ON event_labels (event_code);
