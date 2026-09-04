import type { MeaningfulMarketEvent } from './event.js';
import type { EventId, EventIdSource } from './event-id.js';

/**
 * An event, once it is part of history.
 *
 * Two distinct facts, deliberately separate:
 *
 * - `eventId` is **identity**. Stable, never reused, meaningful outside this
 *   log -- it survives being copied to another store or replayed.
 * - `sequence` is **position**. The log's own ordering, and the thing a
 *   watermark points at. It is not a timestamp: two events can share an
 *   instant, but they cannot share a position.
 *
 * An auto-increment key would supply both and thereby hide the distinction.
 * Keeping them apart means "which event" and "how far have I read" cannot be
 * accidentally substituted for one another.
 */
export interface RecordedMarketEvent {
  readonly eventId: EventId;
  /** 1-based, strictly increasing, never reused. */
  readonly sequence: number;
  readonly event: MeaningfulMarketEvent;
}

/**
 * The append-only history.
 *
 * "Append-only" is enforced here, not merely intended (I2): `append` returns a
 * new sequence and the records are frozen, so a caller holding an older
 * reference keeps seeing exactly what it saw before. Nothing in this module can
 * mutate or remove a record, because the read side is only correct if the thing
 * it reads cannot be rewritten underneath it.
 *
 * This is a data-model commitment, not an infrastructure one. It is an ordered
 * list, and later a table with an ordering column. It is not a message broker.
 */
export interface EventSequence {
  readonly records: readonly RecordedMarketEvent[];
  /** Highest assigned sequence number; 0 when empty. */
  readonly head: number;
}

export const emptySequence: EventSequence = Object.freeze({
  records: Object.freeze([]),
  head: 0,
});

/**
 * Appends events in order, returning a new sequence. The input is untouched.
 *
 * Ids come from a source rather than being generated here, so that appending
 * stays a pure function of its arguments (I3).
 */
export function append(
  log: EventSequence,
  events: readonly MeaningfulMarketEvent[],
  ids: EventIdSource,
): EventSequence {
  if (events.length === 0) {
    return log;
  }

  const appended = events.map((event, index) =>
    Object.freeze({ eventId: ids.next(), sequence: log.head + index + 1, event }),
  );

  return Object.freeze({
    records: Object.freeze([...log.records, ...appended]),
    head: log.head + events.length,
  });
}

/** Every record after `sequence`. The primitive the per-user read is built on. */
export function recordsAfter(log: EventSequence, sequence: number): readonly RecordedMarketEvent[] {
  return log.records.filter((record) => record.sequence > sequence);
}
