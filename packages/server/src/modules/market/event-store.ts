import type {
  EventIdSource,
  InstrumentId,
  MarketDirection,
  MeaningfulMarketEvent,
  RecordedMarketEvent,
} from '@market-pulse/domain';
import { eventId, instrumentId, paise } from '@market-pulse/domain';
import type { Clock } from '@market-pulse/domain';
import type { Database } from '../../db/connection.js';

/**
 * Durable history.
 *
 * The API is the architecture: there is `append` and there are reads, and there
 * is deliberately no `update` or `delete`. A caller cannot rewrite history
 * because this module offers no way to ask. (The database refuses as well --
 * see the triggers in 002 -- because an intent expressed only in an API shape
 * is one `sqlite3` session away from being violated.)
 *
 * Not a repository interface, and not a port. There is one implementation, and
 * an abstraction over it would be indirection with nothing on the other side.
 */

interface EventRow {
  readonly sequence: number;
  readonly event_id: string;
  readonly instrument_id: string;
  readonly direction: string;
  readonly from_price: number;
  readonly to_price: number;
  readonly magnitude_bps: number;
  readonly occurred_at: number;
}

function toRecord(row: EventRow): RecordedMarketEvent {
  return Object.freeze({
    eventId: eventId(row.event_id),
    sequence: row.sequence,
    event: Object.freeze({
      instrumentId: instrumentId(row.instrument_id),
      direction: row.direction as MarketDirection,
      fromPrice: paise(row.from_price),
      toPrice: paise(row.to_price),
      magnitudeBps: row.magnitude_bps,
      occurredAt: row.occurred_at,
    }),
  });
}

export interface EventStore {
  append(events: readonly MeaningfulMarketEvent[]): readonly RecordedMarketEvent[];
  readAfter(sequence: number, instrument?: InstrumentId): readonly RecordedMarketEvent[];
  /**
   * Every record after `sequence` belonging to any of `instruments`.
   *
   * The watchlist read used `readAfter(sequence)` and let `buildWatchlist`
   * discard everything the user does not follow, which made the cost of
   * rendering one row proportional to the size of the whole log: measured at
   * 3.2 / 9.1 / 26.4 ms for logs of 1k / 5k / 20k events, for a user following
   * a single instrument, polled every four seconds. The index that serves this
   * -- `idx_market_events_instrument_sequence` -- already existed and was not
   * being used on that path.
   *
   * Returns nothing for an empty list rather than everything, which is both the
   * correct reading of "events for these instruments" and the only safe
   * behaviour: an empty `IN ()` is not valid SQL.
   */
  readAfterForInstruments(
    sequence: number,
    instruments: readonly InstrumentId[],
  ): readonly RecordedMarketEvent[];
  /** Per-instrument event counts and largest move, for the replay picker. */
  storyCounts(): readonly { instrumentId: InstrumentId; events: number; largestMoveBps: number }[];
  head(): number;
}

/**
 * SQLite's compiled-in bound-parameter ceiling is 32,766 on modern builds, and
 * 999 on older ones. A watchlist will not approach either, but a read whose
 * correctness depends on that staying true is a read that breaks silently the
 * day it stops being true -- so the query is chunked and the results merged.
 */
const MAX_BOUND_PARAMETERS = 900;

export function createEventStore(db: Database, ids: EventIdSource, clock: Clock): EventStore {
  const insert = db.prepare(`
    INSERT INTO market_events
      (event_id, instrument_id, direction, from_price, to_price, magnitude_bps,
       occurred_at, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING sequence
  `);

  const selectAfter = db.prepare(`
    SELECT sequence, event_id, instrument_id, direction, from_price, to_price,
           magnitude_bps, occurred_at
    FROM market_events
    WHERE sequence > ?
    ORDER BY sequence
  `);

  const selectAfterForInstrument = db.prepare(`
    SELECT sequence, event_id, instrument_id, direction, from_price, to_price,
           magnitude_bps, occurred_at
    FROM market_events
    WHERE sequence > ? AND instrument_id = ?
    ORDER BY sequence
  `);

  const selectHead = db.prepare('SELECT COALESCE(MAX(sequence), 0) AS head FROM market_events');

  /**
   * The replay picker's data, aggregated in the database.
   *
   * This was a full `readAfter(0)` followed by a fold into a JS Map on every
   * request -- the entire log materialised as objects to produce one row per
   * instrument. Ordering matches what the picker wants: best story first.
   */
  const selectStoryCounts = db.prepare(`
    SELECT instrument_id,
           COUNT(*)             AS events,
           MAX(magnitude_bps)   AS largest_move_bps
    FROM market_events
    GROUP BY instrument_id
    ORDER BY largest_move_bps DESC
  `);

  return {
    append(events) {
      if (events.length === 0) {
        return [];
      }

      // One transaction: a partially written batch would leave the log claiming
      // a history that never happened.
      const recordedAt = clock.now();
      db.exec('BEGIN');
      try {
        const records = events.map((event) => {
          const id = ids.next();
          const row = insert.get(
            id,
            event.instrumentId,
            event.direction,
            event.fromPrice,
            event.toPrice,
            event.magnitudeBps,
            event.occurredAt,
            recordedAt,
          ) as { sequence: number } | undefined;

          if (row === undefined) {
            throw new Error('Insert did not return a sequence');
          }
          return Object.freeze({ eventId: id, sequence: row.sequence, event });
        });
        db.exec('COMMIT');
        return Object.freeze(records);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    readAfter(sequence, instrument) {
      const rows =
        instrument === undefined
          ? (selectAfter.all(sequence) as unknown as EventRow[])
          : (selectAfterForInstrument.all(sequence, instrument) as unknown as EventRow[]);
      return Object.freeze(rows.map(toRecord));
    },

    readAfterForInstruments(sequence, instruments) {
      if (instruments.length === 0) {
        return Object.freeze([]);
      }

      const rows: EventRow[] = [];
      for (let start = 0; start < instruments.length; start += MAX_BOUND_PARAMETERS) {
        const chunk = instruments.slice(start, start + MAX_BOUND_PARAMETERS);
        // Prepared per chunk because the number of placeholders is part of the
        // statement. The values are still bound, never interpolated.
        const placeholders = chunk.map(() => '?').join(', ');
        const statement = db.prepare(`
          SELECT sequence, event_id, instrument_id, direction, from_price, to_price,
                 magnitude_bps, occurred_at
          FROM market_events
          WHERE sequence > ? AND instrument_id IN (${placeholders})
          ORDER BY sequence
        `);
        rows.push(...(statement.all(sequence, ...chunk) as unknown as EventRow[]));
      }

      // Each chunk is ordered, the concatenation of several is not. Callers
      // downstream treat "first" and "last" as meaning earliest and latest.
      rows.sort((a, b) => a.sequence - b.sequence);
      return Object.freeze(rows.map(toRecord));
    },

    storyCounts() {
      const rows = selectStoryCounts.all() as unknown as {
        instrument_id: string;
        events: number;
        largest_move_bps: number;
      }[];
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            instrumentId: instrumentId(row.instrument_id),
            events: row.events,
            largestMoveBps: row.largest_move_bps,
          }),
        ),
      );
    },

    head() {
      const row = selectHead.get() as { head: number } | undefined;
      return row?.head ?? 0;
    },
  };
}
