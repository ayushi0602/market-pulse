import type { RecordedMarketEvent } from '../market/log.js';
import type { BasisPoints, PriceMinor } from '../market/money.js';
import { changeInBasisPoints } from '../market/money.js';

/**
 * Replay: a projection of history, never a rewrite of it.
 *
 * A `Replay` holds a frozen copy of the timeline and a cursor. Every function
 * here returns a new value; none of them can reach the log, the database, or a
 * watermark. That is the structural guarantee behind R1 and R5 -- replay cannot
 * modify canonical history or a user's read position because it has no way to
 * address either.
 *
 * ## On R4 ("time is injectable")
 *
 * There is no `Clock` here, and that is the honest answer rather than an
 * oversight. Replay is *cursor-based*: a step reveals the next event, and what
 * is visible is a pure function of `(timeline, cursor)`. No wall-clock reading
 * exists to inject. Threading a `Clock` through would be ceremony -- an
 * abstraction with nothing on the other side, which is exactly what the project
 * has refused to do since Phase 1.
 *
 * The one place real time appears is how fast a UI advances the cursor during
 * auto-play. That is a presentation concern, and the component takes the
 * interval as a parameter so a test can drive it without waiting.
 */
export interface Replay {
  /** Frozen, ordered by sequence. Never by timestamp (R3). */
  readonly timeline: readonly RecordedMarketEvent[];
  /** How many events have been revealed. 0 means the story has not started. */
  readonly cursor: number;
}

/**
 * Builds a replay from recorded history.
 *
 * Sorted by `sequence`, explicitly, and not by `occurredAt`: two events can
 * share an instant, and replaying them in a different order than they were
 * recorded would show a story that never happened (R3).
 */
export function createReplay(records: readonly RecordedMarketEvent[]): Replay {
  return Object.freeze({
    timeline: Object.freeze([...records].sort((a, b) => a.sequence - b.sequence)),
    cursor: 0,
  });
}

/** Reveals the next event. At the end, returns the same replay unchanged. */
export function advance(replay: Replay): Replay {
  if (replay.cursor >= replay.timeline.length) {
    return replay;
  }
  return Object.freeze({ timeline: replay.timeline, cursor: replay.cursor + 1 });
}

export function restart(replay: Replay): Replay {
  return replay.cursor === 0 ? replay : Object.freeze({ timeline: replay.timeline, cursor: 0 });
}

export function revealed(replay: Replay): readonly RecordedMarketEvent[] {
  return Object.freeze(replay.timeline.slice(0, replay.cursor));
}

export function isComplete(replay: Replay): boolean {
  return replay.cursor >= replay.timeline.length;
}

/** Where the price was before anything happened: the first event's anchor. */
export function openingPrice(replay: Replay): PriceMinor | undefined {
  return replay.timeline[0]?.event.fromPrice;
}

/**
 * The price as of the cursor.
 *
 * Before the first step this is the opening price; after each step it is the
 * price that event moved to. As recorded -- not a live market price.
 */
export function priceAtCursor(replay: Replay): PriceMinor | undefined {
  if (replay.cursor === 0) {
    return openingPrice(replay);
  }
  return replay.timeline[replay.cursor - 1]?.event.toPrice;
}

/**
 * What a snapshot watchlist would report at this point in the story.
 *
 * The number that makes the demo land: it moves as the story unfolds and
 * returns to zero at the end, while the revealed events do not go away.
 */
export function netChangeAtCursor(replay: Replay): BasisPoints {
  const opening = openingPrice(replay);
  const current = priceAtCursor(replay);
  if (opening === undefined || current === undefined) {
    return 0;
  }
  return changeInBasisPoints(opening, current);
}
