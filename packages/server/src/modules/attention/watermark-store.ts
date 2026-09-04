import type { Clock, UserId, UserReadWatermark } from '@market-pulse/domain';
import { userId } from '@market-pulse/domain';
import type { Database } from '../../db/connection.js';

/**
 * Per-user read position.
 *
 * Separate table, separate module, one row per user -- never a per-user copy of
 * the events themselves. What is shared stays shared; only the position is
 * private (I4).
 */
export interface WatermarkStore {
  /** A user who has never read has an implicit watermark of 0, with no row. */
  get(user: UserId): UserReadWatermark;
  /** Advances to `sequence`. Never moves backwards. Returns the stored result. */
  advanceTo(user: UserId, sequence: number): UserReadWatermark;
}

export function createWatermarkStore(db: Database, clock: Clock): WatermarkStore {
  const select = db.prepare(
    'SELECT user_id, last_read_sequence FROM user_read_watermarks WHERE user_id = ?',
  );

  /**
   * Monotonicity is enforced in SQL, not in application code.
   *
   * `MAX(existing, incoming)` inside the upsert means a stale writer -- an old
   * tab, a phone that was offline, a retried request arriving out of order --
   * cannot un-read what the user has already seen. Doing this as read-then-write
   * in TypeScript would leave a race between the read and the write; doing it in
   * the statement leaves none.
   */
  const upsert = db.prepare(`
    INSERT INTO user_read_watermarks (user_id, last_read_sequence, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      last_read_sequence = MAX(excluded.last_read_sequence, last_read_sequence),
      updated_at         = excluded.updated_at
    RETURNING user_id, last_read_sequence
  `);

  function toWatermark(row: { user_id: string; last_read_sequence: number }): UserReadWatermark {
    return Object.freeze({
      userId: userId(row.user_id),
      lastSeenSequence: row.last_read_sequence,
    });
  }

  return {
    get(user) {
      const row = select.get(user) as { user_id: string; last_read_sequence: number } | undefined;
      return row === undefined
        ? Object.freeze({ userId: user, lastSeenSequence: 0 })
        : toWatermark(row);
    },

    advanceTo(user, sequence) {
      if (!Number.isInteger(sequence) || sequence < 0) {
        throw new RangeError(`Watermark must be a non-negative integer, got ${sequence}`);
      }
      const row = upsert.get(user, sequence, clock.now()) as
        { user_id: string; last_read_sequence: number } | undefined;
      if (row === undefined) {
        throw new Error('Watermark upsert did not return a row');
      }
      return toWatermark(row);
    },
  };
}
