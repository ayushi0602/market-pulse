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
  head(): number;
}

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

    head() {
      const row = selectHead.get() as { head: number } | undefined;
      return row?.head ?? 0;
    },
  };
}
