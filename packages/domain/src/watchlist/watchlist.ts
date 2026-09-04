import type { Timestamp } from '../clock.js';
import type { InstrumentId } from '../market/instrument.js';
import type { RecordedMarketEvent } from '../market/log.js';
import type { BasisPoints, PriceMinor } from '../market/money.js';
import { changeInBasisPoints } from '../market/money.js';

/**
 * The watchlist: what the user cares about.
 *
 * Deliberately not the same list as the attention feed, which is what changed
 * enough to deserve attention. An instrument that never crosses the
 * significance threshold produces no events and appears nowhere in the feed --
 * correct for a feed, and wrong for a watchlist. Keeping them separate is what
 * lets both be right.
 */
export interface WatchlistEntry {
  readonly instrumentId: InstrumentId;
  readonly addedAt: Timestamp;
}

/**
 * The latest observation we hold for an instrument.
 *
 * Named a *snapshot* because that is exactly what it is: current knowledge,
 * overwritten as it changes, making no claim about the past. It is the opposite
 * of the event log in nature, and the two are kept apart on purpose.
 *
 * Not to be confused with `MarketState`, the significance engine's fold state.
 */
export interface InstrumentSnapshot {
  readonly instrumentId: InstrumentId;
  readonly latestPrice: PriceMinor;
  /** When the observation happened. Everything shown from this is "as recorded". */
  readonly observedAt: Timestamp;
}

export type AttentionStatus = 'quiet' | 'changed';

export interface WatchlistRow {
  readonly instrumentId: InstrumentId;
  /** Absent when we follow an instrument we have never observed. */
  readonly snapshot: InstrumentSnapshot | undefined;
  /** Threshold crossings this user has not read. Derived, never stored. */
  readonly meaningfulChanges: number;
  /**
   * Net move across the unread events, or `undefined` when there are none.
   *
   * Undefined rather than 0: "nothing meaningful happened" and "it moved and
   * came back" are different facts, and a watchlist that reported 0.00% for
   * both would be making the exact mistake this product exists to point out.
   */
  readonly netChangeBps: BasisPoints | undefined;
  readonly attention: AttentionStatus;
}

/**
 * Builds the watchlist view.
 *
 * A pure function of three independent inputs: what the user follows, what we
 * last observed, and what they have not read. Attention is **computed here**,
 * never stored as a flag on the entry (W3) -- a stored `hasMeaningfulChange`
 * would need invalidating on every append and every acknowledgement, and would
 * be wrong in between.
 *
 * Membership comes from `entries` alone (W1), so an instrument with no events
 * and no snapshot still appears. That is the whole reason this function exists.
 */
export function buildWatchlist(
  entries: readonly WatchlistEntry[],
  snapshots: readonly InstrumentSnapshot[],
  unread: readonly RecordedMarketEvent[],
): readonly WatchlistRow[] {
  const snapshotByInstrument = new Map(snapshots.map((s) => [s.instrumentId, s]));

  const unreadByInstrument = new Map<InstrumentId, RecordedMarketEvent[]>();
  for (const record of [...unread].sort((a, b) => a.sequence - b.sequence)) {
    const existing = unreadByInstrument.get(record.event.instrumentId);
    if (existing === undefined) {
      unreadByInstrument.set(record.event.instrumentId, [record]);
    } else {
      existing.push(record);
    }
  }

  return Object.freeze(
    entries.map((entry) => {
      const group = unreadByInstrument.get(entry.instrumentId) ?? [];
      const earliest = group[0];
      const latest = group[group.length - 1];

      return Object.freeze({
        instrumentId: entry.instrumentId,
        snapshot: snapshotByInstrument.get(entry.instrumentId),
        meaningfulChanges: group.length,
        netChangeBps:
          earliest === undefined || latest === undefined
            ? undefined
            : changeInBasisPoints(earliest.event.fromPrice, latest.event.toPrice),
        attention: group.length === 0 ? ('quiet' as const) : ('changed' as const),
      });
    }),
  );
}
