import { describe, expect, it } from 'vitest';
import { instrumentId } from '../market/instrument.js';
import { rupees, toPercent } from '../market/money.js';
import { append, emptySequence } from '../market/log.js';
import { sequentialIds } from '../market/event-id.js';
import { observeTicks } from '../market/significance.js';
import type { MarketTick } from '../market/tick.js';
import { buildWatchlist, type InstrumentSnapshot, type WatchlistEntry } from './watchlist.js';

const RELIANCE = instrumentId('RELIANCE');
const INFY = instrumentId('INFY');
const TCS = instrumentId('TCS');
const START = 1_700_000_000_000;

function ticks(instrument: typeof RELIANCE, prices: number[]): MarketTick[] {
  return prices.map((price, index) => ({
    instrumentId: instrument,
    price: rupees(price),
    at: START + index * 60_000,
  }));
}

function unreadFrom(...streams: MarketTick[][]) {
  const ids = sequentialIds();
  let log = emptySequence;
  for (const stream of streams) {
    log = append(log, observeTicks(stream).events, ids);
  }
  return log.records;
}

const entries: WatchlistEntry[] = [
  { instrumentId: RELIANCE, addedAt: START },
  { instrumentId: INFY, addedAt: START },
  { instrumentId: TCS, addedAt: START },
];

const snapshots: InstrumentSnapshot[] = [
  { instrumentId: RELIANCE, latestPrice: rupees(100), observedAt: START },
  { instrumentId: INFY, latestPrice: rupees(80), observedAt: START },
  { instrumentId: TCS, latestPrice: rupees(3805), observedAt: START },
];

describe('W1: membership is independent of market events', () => {
  it('keeps a quiet instrument on the list', () => {
    // TCS never crosses the threshold, so it appears nowhere in the feed. It
    // must still appear here: the user said they care about it.
    const rows = buildWatchlist(
      entries,
      snapshots,
      unreadFrom(ticks(RELIANCE, [100, 96, 91, 95, 100]), ticks(INFY, [100, 80])),
    );

    expect(rows.map((r) => r.instrumentId)).toEqual([RELIANCE, INFY, TCS]);
    const tcs = rows.find((r) => r.instrumentId === TCS);
    expect(tcs?.attention).toBe('quiet');
    expect(tcs?.meaningfulChanges).toBe(0);
  });

  it('keeps an instrument with no events at all', () => {
    const rows = buildWatchlist(entries, snapshots, []);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.attention === 'quiet')).toBe(true);
  });

  it('shows an instrument we follow but have never observed', () => {
    const rows = buildWatchlist([{ instrumentId: TCS, addedAt: START }], [], []);
    expect(rows[0]?.instrumentId).toBe(TCS);
    expect(rows[0]?.snapshot).toBeUndefined();
  });

  it('does not invent rows for instruments the user does not follow', () => {
    const rows = buildWatchlist(
      [{ instrumentId: TCS, addedAt: START }],
      snapshots,
      unreadFrom(ticks(RELIANCE, [100, 91])),
    );
    expect(rows.map((r) => r.instrumentId)).toEqual([TCS]);
  });
});

describe('W2: a quiet instrument still has a latest recorded state', () => {
  it('carries the snapshot and its observation time', () => {
    const rows = buildWatchlist(entries, snapshots, []);
    const tcs = rows.find((r) => r.instrumentId === TCS);
    expect(tcs?.snapshot?.latestPrice).toBe(rupees(3805));
    expect(tcs?.snapshot?.observedAt).toBe(START);
  });
});

describe('W3: attention is derived, never stored', () => {
  it('marks an instrument changed only while it has unread events', () => {
    const unread = unreadFrom(ticks(RELIANCE, [100, 96, 91, 95, 100]));

    const withUnread = buildWatchlist(entries, snapshots, unread);
    expect(withUnread.find((r) => r.instrumentId === RELIANCE)?.attention).toBe('changed');

    // The same entries and snapshots, with the events read. Nothing was
    // invalidated or written; the answer simply changes with the input.
    const afterReading = buildWatchlist(entries, snapshots, []);
    expect(afterReading.find((r) => r.instrumentId === RELIANCE)?.attention).toBe('quiet');
  });

  it('counts only the unread events it was given', () => {
    const all = unreadFrom(ticks(RELIANCE, [100, 96, 91, 95, 100]));
    const half = all.slice(1);
    expect(buildWatchlist(entries, snapshots, all)[0]?.meaningfulChanges).toBe(2);
    expect(buildWatchlist(entries, snapshots, half)[0]?.meaningfulChanges).toBe(1);
  });

  it('distinguishes "nothing happened" from "it moved and came back"', () => {
    const roundTrip = buildWatchlist(
      entries,
      snapshots,
      unreadFrom(ticks(RELIANCE, [100, 96, 91, 95, 100])),
    ).find((r) => r.instrumentId === RELIANCE);
    const quiet = buildWatchlist(entries, snapshots, []).find((r) => r.instrumentId === RELIANCE);

    // Both would read 0.00% to a snapshot watchlist. They are not the same fact,
    // and the model refuses to say they are.
    expect(roundTrip?.netChangeBps).toBe(0);
    expect(roundTrip?.meaningfulChanges).toBe(2);
    expect(quiet?.netChangeBps).toBeUndefined();
    expect(quiet?.meaningfulChanges).toBe(0);
  });

  it('reports a real net change when there is one', () => {
    const rows = buildWatchlist(entries, snapshots, unreadFrom(ticks(INFY, [100, 80])));
    expect(toPercent(rows.find((r) => r.instrumentId === INFY)?.netChangeBps ?? 0)).toBe(-20);
  });
});

describe('the view is a pure function of its inputs', () => {
  it('does not mutate anything it is given', () => {
    const unread = unreadFrom(ticks(RELIANCE, [100, 91]));
    const before = {
      entries: structuredClone(entries),
      snapshots: structuredClone(snapshots),
      unread: structuredClone([...unread]),
    };
    buildWatchlist(entries, snapshots, unread);
    expect(structuredClone(entries)).toEqual(before.entries);
    expect(structuredClone(snapshots)).toEqual(before.snapshots);
    expect(structuredClone([...unread])).toEqual(before.unread);
  });

  it('is unaffected by the order unread records arrive in', () => {
    const unread = unreadFrom(ticks(RELIANCE, [100, 96, 91, 95, 100]));
    expect(buildWatchlist(entries, snapshots, [...unread].reverse())).toEqual(
      buildWatchlist(entries, snapshots, unread),
    );
  });
});
