import type { InstrumentId } from '../market/instrument.js';
import type { RecordedMarketEvent } from '../market/log.js';
import type { BasisPoints, PriceMinor } from '../market/money.js';
import { changeInBasisPoints } from '../market/money.js';

/**
 * What a traditional watchlist would have told the user, computed from the same
 * events, so the two answers can be shown side by side.
 *
 * This is the honest form of the product's central claim. Rather than asserting
 * that a snapshot view is inadequate, the feed carries the snapshot's own answer
 * -- the net change from where the price was when the user last looked to where
 * it is now -- and lets the two be compared. When that number is 0.00% and
 * `meaningfulChanges` is 2, the argument makes itself.
 */
export interface InstrumentSummary {
  readonly instrumentId: InstrumentId;
  /**
   * The anchor the earliest unread event was measured from: where the price was
   * resting when this user last looked.
   */
  readonly priceWhenLastSeen: PriceMinor;
  /**
   * The price at the most recent unread event.
   *
   * The latest price *the log knows about*, which is not necessarily the live
   * market price -- no tick since the last threshold crossing is recorded. Any
   * label on this must say "as recorded", never "current".
   */
  readonly latestPrice: PriceMinor;
  /** Net move between those two. What a snapshot comparison would report. */
  readonly netChangeBps: BasisPoints;
  /** How many threshold crossings happened in between. */
  readonly meaningfulChanges: number;
}

/**
 * Summarises unread events per instrument, in first-seen order.
 *
 * A pure function of the records handed in. It reads nothing, stores nothing,
 * and does not care which user the records were selected for.
 */
export function summariseUnread(
  records: readonly RecordedMarketEvent[],
): readonly InstrumentSummary[] {
  const byInstrument = new Map<InstrumentId, RecordedMarketEvent[]>();

  // Ordered by sequence so "earliest" and "latest" mean what they say,
  // regardless of the order the caller passed them in.
  for (const record of [...records].sort((a, b) => a.sequence - b.sequence)) {
    const existing = byInstrument.get(record.event.instrumentId);
    if (existing === undefined) {
      byInstrument.set(record.event.instrumentId, [record]);
    } else {
      existing.push(record);
    }
  }

  const summaries: InstrumentSummary[] = [];
  for (const [instrumentId, group] of byInstrument) {
    const earliest = group[0];
    const latest = group[group.length - 1];
    if (earliest === undefined || latest === undefined) {
      continue;
    }
    summaries.push(
      Object.freeze({
        instrumentId,
        priceWhenLastSeen: earliest.event.fromPrice,
        latestPrice: latest.event.toPrice,
        netChangeBps: changeInBasisPoints(earliest.event.fromPrice, latest.event.toPrice),
        meaningfulChanges: group.length,
      }),
    );
  }

  return Object.freeze(summaries);
}
