import type { MeaningfulMarketEvent } from './event.js';

/**
 * Is a move specific to this instrument, or part of something wider?
 *
 * A threshold crossing is a fact about one instrument in isolation -- the
 * significance engine has no other instrument to compare against, by design
 * (I3: it is a pure fold over one tick stream). This is the next question, and
 * it is deliberately answered as a *separate*, later step over the recorded
 * events, not folded into the engine itself: classification needs a second
 * instrument's history, and the engine must not.
 *
 * - `market-wide` -- the benchmark moved the same way, by a comparable amount,
 *   at or before this event. The instrument is doing what everything is doing.
 * - `outlier` -- the benchmark moved the same way, but by much less. The
 *   instrument moved further than the market it sits inside.
 * - `stock-specific` -- the benchmark moved the other way, or has no recorded
 *   move to compare against at all. Whatever happened, it happened to this
 *   instrument and not (as far as the system can tell) to the market.
 */
export type SignalClassification = 'market-wide' | 'stock-specific' | 'outlier';

/**
 * How much larger a move has to be than the benchmark's to count as amplified
 * rather than merely "in the same direction as." 1.5x is a placeholder, in the
 * same spirit as `DEFAULT_RULE.thresholdBps` -- legible for tests, not
 * calibrated against a real index.
 */
export const OUTLIER_FACTOR = 1.5;

/**
 * Classifies one event against a benchmark's own recorded history.
 *
 * `benchmarkEvents` may be given the benchmark's *entire* history, including
 * events that happen after `event` -- the function itself discards anything
 * with `occurredAt` later than the event being classified. This is what makes
 * "replay must judge an event by what was knowable at the time, not by what
 * the benchmark did afterward" a structural property of the function rather
 * than a rule a caller has to remember to uphold: there is no way to call this
 * with the future and have it matter (SC1).
 *
 * Absence of a comparable benchmark move is not evidence of a market-wide
 * move -- it is evidence of nothing, and the honest reading of nothing is
 * `stock-specific`: whatever happened, this system has no recorded reason to
 * believe the wider market was doing the same thing at the same time.
 */
export function classifySignal(
  event: MeaningfulMarketEvent,
  benchmarkEvents: readonly MeaningfulMarketEvent[],
): SignalClassification {
  // The most recent benchmark event at or before this one. Ties count: a
  // benchmark move recorded at the exact same instant is still evidence of a
  // concurrent market move, not a later one.
  let reference: MeaningfulMarketEvent | undefined;
  for (const candidate of benchmarkEvents) {
    if (candidate.occurredAt > event.occurredAt) continue;
    if (reference === undefined || candidate.occurredAt > reference.occurredAt) {
      reference = candidate;
    }
  }

  if (reference?.direction !== event.direction) {
    return 'stock-specific';
  }

  return event.magnitudeBps > reference.magnitudeBps * OUTLIER_FACTOR ? 'outlier' : 'market-wide';
}
