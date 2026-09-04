import type { Clock, InstrumentId, UserId, WatchlistEntry } from '@market-pulse/domain';
import { instrumentId } from '@market-pulse/domain';
import type { Database } from '../../db/connection.js';

/**
 * What each user follows.
 *
 * Removing an entry deletes a statement of interest and nothing else (W4). The
 * event log is market history and is not the user's to delete; this store has
 * no access to it.
 */
export interface WatchlistStore {
  list(user: UserId): readonly WatchlistEntry[];
  add(user: UserId, instrument: InstrumentId): readonly WatchlistEntry[];
  remove(user: UserId, instrument: InstrumentId): readonly WatchlistEntry[];
}

interface EntryRow {
  readonly instrument_id: string;
  readonly added_at: number;
}

export function createWatchlistStore(db: Database, clock: Clock): WatchlistStore {
  const select = db.prepare(
    'SELECT instrument_id, added_at FROM watchlist_entries WHERE user_id = ? ORDER BY added_at, instrument_id',
  );

  // Adding twice is not an error and does not reset when it was added: the
  // entry is a fact about interest, and it was already true.
  const insert = db.prepare(`
    INSERT INTO watchlist_entries (user_id, instrument_id, added_at)
    VALUES (?, ?, ?)
    ON CONFLICT (user_id, instrument_id) DO NOTHING
  `);

  const del = db.prepare('DELETE FROM watchlist_entries WHERE user_id = ? AND instrument_id = ?');

  function list(user: UserId): readonly WatchlistEntry[] {
    return Object.freeze(
      (select.all(user) as unknown as EntryRow[]).map((row) =>
        Object.freeze({
          instrumentId: instrumentId(row.instrument_id),
          addedAt: row.added_at,
        }),
      ),
    );
  }

  return {
    list,
    add(user, instrument) {
      insert.run(user, instrument, clock.now());
      return list(user);
    },
    remove(user, instrument) {
      del.run(user, instrument);
      return list(user);
    },
  };
}
