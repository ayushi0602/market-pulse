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
 *   recently enough to be comparable. The instrument is doing what everything
 *   is doing.
 * - `outlier` -- the benchmark moved the same way and recently enough, but by
 *   much less. The instrument moved further than the market it sits inside.
 * - `stock-specific` -- the benchmark moved the other way, has no recorded move
 *   to compare against, or last moved too long ago to say anything about this.
 *   Whatever happened, it happened to this instrument and not (as far as the
 *   system can tell) to the market.
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
 * How old the benchmark's last move may be and still say something about this
 * one. Thirty minutes.
 *
 * Without a bound, the *most recent* benchmark move is used no matter how long
 * ago it happened -- and because the benchmark crosses the same 5% threshold as
 * everything else, it can sit still for hours. The running app classified a
 * ZOMATO advance as `market-wide` against a NIFTY advance from 73 minutes
 * earlier, and told the reader the instrument was "doing what everything is
 * doing" about a market that had been flat since. Two moves an hour apart are
 * not evidence of one thing happening.
 *
 * The value is a placeholder in the same spirit as `DEFAULT_RULE.thresholdBps`
 * and `OUTLIER_FACTOR` -- legible, not calibrated against a real index. It is
 * the seeded market's own observation cadence: one tick per half hour, so a
 * benchmark move stays comparable exactly as long as it takes the next
 * observation to arrive and supersede it.
 *
 * Widening it re-admits stale references. Narrowing it below the observation
 * interval would make simultaneous moves incomparable, which is the opposite
 * failure -- so this is a floor as much as a ceiling.
 */
export const MAX_BENCHMARK_REFERENCE_AGE_MS = 1_800_000;

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
 * believe the wider market was doing the same thing at the same time. A
 * benchmark that last moved hours ago is a form of that absence, which is why
 * `MAX_BENCHMARK_REFERENCE_AGE_MS` bounds how far back a reference may sit.
 */
export function classifySignal(
  event: MeaningfulMarketEvent,
  benchmarkEvents: readonly MeaningfulMarketEvent[],
): SignalClassification {
  // The most recent benchmark event at or before this one, and no older than
  // the reference window. Ties count at both ends: a benchmark move recorded at
  // the exact same instant is evidence of a concurrent market move, and one
  // exactly at the window's edge is still inside it.
  const oldestAdmissible = event.occurredAt - MAX_BENCHMARK_REFERENCE_AGE_MS;
  let reference: MeaningfulMarketEvent | undefined;
  for (const candidate of benchmarkEvents) {
    if (candidate.occurredAt > event.occurredAt) continue;
    if (candidate.occurredAt < oldestAdmissible) continue;
    if (reference === undefined || candidate.occurredAt > reference.occurredAt) {
      reference = candidate;
    }
  }

  if (reference?.direction !== event.direction) {
    return 'stock-specific';
  }

  return event.magnitudeBps > reference.magnitudeBps * OUTLIER_FACTOR ? 'outlier' : 'market-wide';
}
