import type { Clock, InstrumentId, InstrumentSnapshot } from '@market-pulse/domain';
import { instrumentId, paise } from '@market-pulse/domain';
import type { Database } from '../../db/connection.js';

/**
 * Latest recorded observation per instrument.
 *
 * Unlike the event store, this one *does* overwrite: a snapshot is current
 * knowledge, not history, and it makes no claim about the past. Keeping the two
 * in separate tables with opposite rules is the schema-level statement of the
 * whole product thesis.
 */
export interface SnapshotStore {
  record(instrument: InstrumentId, price: number, observedAt: number): InstrumentSnapshot;
  list(): readonly InstrumentSnapshot[];
  /**
   * Only the snapshots asked for.
   *
   * The watchlist read used `list()` and discarded the rest, so rendering one
   * user's rows scanned every instrument the system has ever observed. Empty in
   * means empty out -- an empty `IN ()` is not valid SQL, and "the snapshots for
   * no instruments" is genuinely none of them.
   */
  listFor(instruments: readonly InstrumentId[]): readonly InstrumentSnapshot[];
}

/** Matches the event store's chunking, and for the same reason. */
const MAX_BOUND_PARAMETERS = 900;

interface SnapshotRow {
  readonly instrument_id: string;
  readonly latest_price: number;
  readonly observed_at: number;
}

function toSnapshot(row: SnapshotRow): InstrumentSnapshot {
  return Object.freeze({
    instrumentId: instrumentId(row.instrument_id),
    latestPrice: paise(row.latest_price),
    observedAt: row.observed_at,
  });
}

export function createSnapshotStore(db: Database, clock: Clock): SnapshotStore {
  /**
   * Only moves forward in observation time. A late-arriving reading of an older
   * moment must not overwrite a newer one -- the same monotonicity argument as
   * the watermark, enforced in the same place, for the same reason.
   */
  const upsert = db.prepare(`
    INSERT INTO instrument_snapshots (instrument_id, latest_price, observed_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (instrument_id) DO UPDATE SET
      latest_price = CASE WHEN excluded.observed_at >= observed_at
                          THEN excluded.latest_price ELSE latest_price END,
      observed_at  = MAX(excluded.observed_at, observed_at),
      updated_at   = excluded.updated_at
    RETURNING instrument_id, latest_price, observed_at
  `);

  const selectAll = db.prepare(
    'SELECT instrument_id, latest_price, observed_at FROM instrument_snapshots ORDER BY instrument_id',
  );

  return {
    record(instrument, price, observedAt) {
      const row = upsert.get(instrument, price, observedAt, clock.now()) as SnapshotRow | undefined;
      if (row === undefined) {
        throw new Error('Snapshot upsert did not return a row');
      }
      return toSnapshot(row);
    },

    list() {
      return Object.freeze((selectAll.all() as unknown as SnapshotRow[]).map(toSnapshot));
    },

    listFor(instruments) {
      if (instruments.length === 0) {
        return Object.freeze([]);
      }

      const rows: SnapshotRow[] = [];
      for (let start = 0; start < instruments.length; start += MAX_BOUND_PARAMETERS) {
        const chunk = instruments.slice(start, start + MAX_BOUND_PARAMETERS);
        const placeholders = chunk.map(() => '?').join(', ');
        const statement = db.prepare(`
          SELECT instrument_id, latest_price, observed_at
          FROM instrument_snapshots
          WHERE instrument_id IN (${placeholders})
          ORDER BY instrument_id
        `);
        rows.push(...(statement.all(...chunk) as unknown as SnapshotRow[]));
      }

      rows.sort((a, b) => a.instrument_id.localeCompare(b.instrument_id));
      return Object.freeze(rows.map(toSnapshot));
    },
  };
}
