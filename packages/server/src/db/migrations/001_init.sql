-- Baseline migration.
--
-- Step 1 establishes the migration mechanism itself and nothing else. Domain
-- tables (ticks, the event log, per-user read watermarks) arrive with the
-- features that need them, in their own numbered migrations.

CREATE TABLE IF NOT EXISTS app_metadata (
  key        TEXT    NOT NULL PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO app_metadata (key, value, updated_at)
VALUES ('schema_baseline', '001_init', unixepoch() * 1000)
ON CONFLICT (key) DO NOTHING;
