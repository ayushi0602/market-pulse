import type { RecordedMarketEvent } from '../market/log.js';

/**
 * Which already-meaningful events deserve attention first.
 *
 * Every event in the log has already crossed the significance threshold, so
 * this is not "is it significant" -- that question was answered by the engine.
 * It is only "in what order should a returning user read them".
 *
 * Deliberately simple: magnitude, largest first, with the newer event winning a
 * tie. Volatility normalisation, volume anomalies and market-relative movement
 * are all plausible refinements and none of them are justified before there is
 * a screen to judge them against. Faking sophistication here would be
 * unfalsifiable -- nobody can tell a good weighting from a bad one without the
 * UX to compare them in.
 */

/**
 * Ranks a copy, largest magnitude first. Ties break toward the newer event.
 *
 * Total order, not merely a stable sort: sequences are unique, so the
 * comparator never returns 0 for two distinct records and the result cannot
 * depend on the engine's sort implementation (F5).
 */
export function rankBySignificance(
  records: readonly RecordedMarketEvent[],
): readonly RecordedMarketEvent[] {
  return Object.freeze(
    [...records].sort((a, b) => {
      const byMagnitude = b.event.magnitudeBps - a.event.magnitudeBps;
      if (byMagnitude !== 0) {
        return byMagnitude;
      }
      // Sequence, not occurredAt: two events can share an instant, and a
      // tie-break that can itself tie is not a tie-break.
      return b.sequence - a.sequence;
    }),
  );
}
