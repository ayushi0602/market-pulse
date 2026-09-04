import { describe, expect, it } from 'vitest';
import { instrumentId } from '../market/instrument.js';
import { rupees, toPercent, toRupees } from '../market/money.js';
import { append, emptySequence } from '../market/log.js';
import { sequentialIds } from '../market/event-id.js';
import { observeTicks } from '../market/significance.js';
import type { MarketTick } from '../market/tick.js';
import { summariseUnread } from './feed.js';

const RELIANCE = instrumentId('RELIANCE');
const INFY = instrumentId('INFY');
const START = 1_700_000_000_000;

function ticks(instrument: typeof RELIANCE, prices: number[]): MarketTick[] {
  return prices.map((price, index) => ({
    instrumentId: instrument,
    price: rupees(price),
    at: START + index * 60_000,
  }));
}

function logFor(...streams: MarketTick[][]) {
  const ids = sequentialIds();
  let log = emptySequence;
  for (const stream of streams) {
    log = append(log, observeTicks(stream).events, ids);
  }
  return log.records;
}

describe('the comparison a snapshot watchlist would give', () => {
  it('reports no net change while reporting two meaningful changes', () => {
    // This is the product thesis as a single assertion.
    const summaries = summariseUnread(logFor(ticks(RELIANCE, [100, 96, 91, 95, 100])));
    expect(summaries).toHaveLength(1);

    const reliance = summaries[0];
    expect(reliance?.meaningfulChanges).toBe(2);
    expect(reliance?.netChangeBps).toBe(0);
    expect(toRupees(reliance?.priceWhenLastSeen ?? rupees(0))).toBe(100);
    expect(toRupees(reliance?.latestPrice ?? rupees(0))).toBe(100);
  });

  it('reports a real net change when there is one', () => {
    const summaries = summariseUnread(logFor(ticks(RELIANCE, [100, 91])));
    expect(toPercent(summaries[0]?.netChangeBps ?? 0)).toBe(-9);
    expect(summaries[0]?.meaningfulChanges).toBe(1);
  });

  it('summarises each instrument separately', () => {
    const summaries = summariseUnread(
      logFor(ticks(RELIANCE, [100, 96, 91, 95, 100]), ticks(INFY, [100, 80])),
    );
    expect(summaries.map((s) => s.instrumentId)).toEqual([RELIANCE, INFY]);
    expect(summaries.map((s) => s.meaningfulChanges)).toEqual([2, 1]);
    expect(summaries.map((s) => s.netChangeBps)).toEqual([0, -2000]);
  });

  it('is unaffected by the order records arrive in', () => {
    const records = logFor(ticks(RELIANCE, [100, 96, 91, 95, 100]));
    const reversed = [...records].reverse();
    expect(summariseUnread(reversed)).toEqual(summariseUnread(records));
  });

  it('handles an empty feed', () => {
    expect(summariseUnread([])).toEqual([]);
  });
});
