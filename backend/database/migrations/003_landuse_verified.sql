-- 003_landuse_verified.sql — distinguish genuine no-match from transient lookup failure.
--
-- landuse_verified = TRUE  -> the Overpass lookup behind this tag succeeded.
--   A verified "unknown" is a genuine no-match (no mapped polygon nearby) and
--   is NOT re-queried on the next refresh.
-- landuse_verified NULL/FALSE -> transient failure (Overpass 429/504/timeout)
--   or never attempted. These rows are retried on the next refresh.
--
-- Backfill: rows already carrying a real class were tagged successfully, so
-- they are verified. Rows still "unknown" from the first cold batch (which
-- ran into the 2026-09-26 Overpass rate-limit storm) are left NULL so they
-- get exactly one more attempt with the gentler retry logic.

ALTER TABLE thermal_events ADD COLUMN IF NOT EXISTS landuse_verified BOOLEAN;

UPDATE thermal_events
SET landuse_verified = TRUE
WHERE landuse_class IS NOT NULL AND landuse_class <> 'unknown';
