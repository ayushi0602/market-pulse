import type { MeaningfulMarketEvent } from './event.js';

/**
 * An event, once it is part of history.
 *
 * The sequence number is assigned on append and is what "where I last looked"
 * refers to. It is the log's own ordering, not a timestamp: two events can
 * share an instant, but they cannot share a position.
 */
export interface RecordedMarketEvent {
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

/** Appends events in order, returning a new sequence. The input is untouched. */
export function append(
  log: EventSequence,
  events: readonly MeaningfulMarketEvent[],
): EventSequence {
  if (events.length === 0) {
    return log;
  }

  const appended = events.map((event, index) =>
    Object.freeze({ sequence: log.head + index + 1, event }),
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
