/**
 * A moment in time, held as epoch milliseconds.
 *
 * The domain never reads the wall clock directly. Every rule that needs "now"
 * takes a Clock, which keeps time-dependent logic deterministic under test and
 * keeps the domain free of ambient globals.
 */
export type Timestamp = number;

export interface Clock {
  now(): Timestamp;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** A Clock that returns a fixed instant, for tests and replay. */
export function fixedClock(at: Timestamp): Clock {
  return { now: () => at };
}
