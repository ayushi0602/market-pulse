-- Durable history and per-user read position.
--
-- Two tables, and the relationship between them is the point:
--
--   market_events         shared, written once, read by everyone
--   user_read_watermarks  per user, one row, a position into the above
--
-- Events are stored ONCE and referenced by position. There is deliberately no
-- per-user copy of an event: fan-out on write would multiply storage by the
-- user count, and would make "what did I miss" a question about a user's
-- private queue rather than about shared history. The whole product is that the
-- history is one thing and the reading of it is many.

CREATE TABLE IF NOT EXISTS market_events (
  -- Position. AUTOINCREMENT, not plain INTEGER PRIMARY KEY, so a value is never
  -- reused even in principle: a watermark pointing at 41 must never come to
  -- mean a different event than it did yesterday.
  sequence      INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Identity. Separate from position on purpose, and unique so that re-ingesting
  -- the same event is a detectable conflict rather than a silent duplicate.
  event_id      TEXT    NOT NULL UNIQUE,

  instrument_id TEXT    NOT NULL,
  direction     TEXT    NOT NULL CHECK (direction IN ('decline', 'advance')),

  -- Prices are integer minor units and magnitude is basis points, matching the
  -- domain exactly. Storing a REAL percentage here would reintroduce, at the
  -- persistence boundary, precisely the floating-point imprecision the domain
  -- types exist to prevent -- and would make a stored event disagree with the
  -- event that produced it.
  from_price    INTEGER NOT NULL CHECK (from_price >= 0),
  to_price      INTEGER NOT NULL CHECK (to_price >= 0),
  magnitude_bps INTEGER NOT NULL CHECK (magnitude_bps >= 0),

  -- When it happened in the market, epoch ms. Not when we wrote it down.
  occurred_at   INTEGER NOT NULL,
  recorded_at   INTEGER NOT NULL
);

-- The read pattern is "everything after position N", usually for one instrument.
CREATE INDEX IF NOT EXISTS idx_market_events_instrument_sequence
  ON market_events (instrument_id, sequence);

-- Append-only, enforced by the database rather than by convention.
--
-- The store's API omits update and delete, which expresses the intent. These
-- triggers make it true regardless of what any future caller, migration, or
-- console session attempts. I2 is the load-bearing claim of the product; it
-- should not rest on everyone remembering it.
CREATE TRIGGER IF NOT EXISTS market_events_are_immutable
BEFORE UPDATE ON market_events
BEGIN
  SELECT RAISE(ABORT, 'market_events is append-only: events cannot be modified');
END;

CREATE TRIGGER IF NOT EXISTS market_events_are_permanent
BEFORE DELETE ON market_events
BEGIN
  SELECT RAISE(ABORT, 'market_events is append-only: events cannot be deleted');
END;

CREATE TABLE IF NOT EXISTS user_read_watermarks (
  user_id            TEXT    NOT NULL PRIMARY KEY,

  -- A position into market_events, not an event_id. 0 means "has read nothing".
  -- Intentionally not a foreign key: the watermark is a high-water mark, and
  -- must remain valid at 0 and at any position, including one whose row is the
  -- current head.
  last_read_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),

  updated_at         INTEGER NOT NULL
);
