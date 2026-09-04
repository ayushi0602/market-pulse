/**
 * Identity, which is not ordering.
 *
 * `EventId` says *which* event this is. `sequence` (assigned by the log) says
 * *where* it sits in history. Conflating them is a trap: an auto-increment
 * primary key happens to provide both, so a model built on it quietly assumes
 * that identity and position are the same fact. They are not. A position is a
 * property of one log; an identity should survive being copied between stores,
 * replayed, or deduplicated on ingest.
 *
 * The watermark therefore tracks a **sequence**, never an id.
 */
declare const eventIdBrand: unique symbol;
export type EventId = string & { readonly [eventIdBrand]: 'EventId' };

export function eventId(value: string): EventId {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new RangeError('Event id cannot be empty');
  }
  return trimmed as EventId;
}

/**
 * Where new ids come from.
 *
 * A port for the same reason `Clock` is one: generating an id requires either
 * randomness or a platform API, and the domain must stay deterministic and
 * free of both. Two real implementations exist -- the server's UUID source and
 * the deterministic counter below -- which is what justifies the indirection.
 */
export interface EventIdSource {
  next(): EventId;
}

/**
 * Deterministic ids for tests and replay: `evt-1`, `evt-2`, ...
 *
 * Stateful by design; each source is independent. Never use in production,
 * where ids must be unique across processes.
 */
export function sequentialIds(prefix = 'evt'): EventIdSource {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return eventId(`${prefix}-${counter}`);
    },
  };
}
