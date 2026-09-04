-- What the user follows, and the latest thing we know about each instrument.
--
-- Two tables with deliberately opposite natures, and the contrast is the
-- product in miniature:
--
--   market_events        history.   Append-only. Never overwritten.
--   instrument_snapshots knowledge. Overwritten every time we learn something.
--
-- A traditional watchlist keeps only the second kind and is therefore silent
-- about everything that happened between two readings. Market Pulse keeps both.
-- Snapshots are mutable *on purpose*; that is not a weakening of I2, because a
-- snapshot makes no claim about the past.

-- Named instrument_snapshots rather than market_state: the domain already has a
-- `MarketState`, which is the significance engine's fold state (anchor, last
-- price, last instant). Reusing that name for "latest recorded observation"
-- would make two genuinely different things look like one.
CREATE TABLE IF NOT EXISTS instrument_snapshots (
  instrument_id TEXT    NOT NULL PRIMARY KEY,
  latest_price  INTEGER NOT NULL CHECK (latest_price >= 0),
  -- When the observation happened, epoch ms. Not when we stored it.
  observed_at   INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- One watchlist per user, deliberately. A `watchlist_id` would be a placeholder
-- constant until multiple watchlists exist, for the same reason it was left out
-- of user_read_watermarks in 002.
CREATE TABLE IF NOT EXISTS watchlist_entries (
  user_id       TEXT    NOT NULL,
  instrument_id TEXT    NOT NULL,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, instrument_id)
);

-- No foreign key to market_events or instrument_snapshots, and that is the
-- point (W1): a user may follow an instrument that has produced no events and
-- that we have never observed. Membership is a statement of interest, not a
-- claim that data exists.
CREATE INDEX IF NOT EXISTS idx_watchlist_entries_user ON watchlist_entries (user_id, added_at);
