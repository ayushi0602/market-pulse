import { describe, expect, it } from 'vitest';
import { instrumentId } from './instrument.js';
import { rupees } from './money.js';
import type { MarketTick } from './tick.js';
import { DEFAULT_RULE, initialState, observeTick, observeTicks } from './significance.js';

const ACME = instrumentId('ACME');
const OTHER = instrumentId('OTHER');
const START = 1_700_000_000_000;

function tick(price: number, offsetMs = 0, instrument = ACME): MarketTick {
  return { instrumentId: instrument, price: rupees(price), at: START + offsetMs };
}

describe('significance engine', () => {
  it('says nothing about a move smaller than the threshold', () => {
    const { events } = observeTick(initialState(tick(100)), tick(96, 1000));
    expect(events).toHaveLength(0);
  });

  it('emits once the move from the anchor crosses the threshold', () => {
    const { events } = observeTick(initialState(tick(100)), tick(91, 1000));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      direction: 'decline',
      magnitudeBps: 900,
      occurredAt: START + 1000,
    });
  });

  it('treats the threshold as inclusive', () => {
    // Exactly 5%, the DEFAULT_RULE boundary. Off-by-one here would mean events
    // silently need to be 5.01% to be reported.
    const { events } = observeTick(initialState(tick(100)), tick(95, 1000));
    expect(events).toHaveLength(1);
    expect(events[0]?.magnitudeBps).toBe(DEFAULT_RULE.thresholdBps);
  });

  it('measures from the anchor, so a slow slide is not invisible', () => {
    // No single step is significant; the cumulative move is.
    const ticks = [tick(100, 0), tick(99, 1), tick(98, 2), tick(97, 3), tick(96, 4), tick(95, 5)];
    const { events } = observeTicks(ticks);
    expect(events).toHaveLength(1);
    expect(events[0]?.magnitudeBps).toBe(500);
  });

  it('re-anchors after an event so the same move is not reported twice', () => {
    const after = observeTick(initialState(tick(100)), tick(91, 1));
    expect(after.state.anchorPrice).toBe(rupees(91));

    // 95 is +4.4% from the new anchor of 91: not significant, even though it is
    // still 5% below where the run began.
    expect(observeTick(after.state, tick(95, 2)).events).toHaveLength(0);
  });

  it('reports a rise as an advance', () => {
    const { events } = observeTick(initialState(tick(100)), tick(110, 1));
    expect(events[0]).toMatchObject({ direction: 'advance', magnitudeBps: 1000 });
  });

  it('honours a caller-supplied rule', () => {
    const strict = { thresholdBps: 2_000 };
    expect(observeTick(initialState(tick(100)), tick(91, 1), strict).events).toHaveLength(0);
    expect(observeTick(initialState(tick(100)), tick(75, 1), strict).events).toHaveLength(1);
  });
});

describe('engine guards', () => {
  it('refuses a tick for a different instrument', () => {
    expect(() => observeTick(initialState(tick(100)), tick(91, 1, OTHER))).toThrow(
      /cannot be applied/,
    );
  });

  it('refuses an out-of-order tick rather than corrupting history', () => {
    const state = observeTick(initialState(tick(100, 0)), tick(101, 5_000)).state;
    expect(() => observeTick(state, tick(102, 1_000))).toThrow(/Out-of-order/);
  });

  it('handles an empty tick stream', () => {
    expect(observeTicks([])).toEqual({ state: undefined, events: [] });
  });
});

describe('I3: the engine is deterministic and pure', () => {
  const ticks = [tick(100, 0), tick(96, 1), tick(91, 2), tick(95, 3), tick(100, 4)];

  it('produces identical output for identical input, every time', () => {
    const runs = Array.from({ length: 50 }, () => observeTicks(ticks));
    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });

  it('does not mutate the state it is given', () => {
    const before = initialState(tick(100));
    const snapshot = { ...before };
    observeTick(before, tick(91, 1));
    expect(before).toEqual(snapshot);
  });

  it('does not mutate the ticks it is given', () => {
    const input = [tick(100, 0), tick(91, 1)];
    const snapshot = structuredClone(input);
    observeTicks(input);
    expect(input).toEqual(snapshot);
  });

  it('reads no clock: output depends only on tick timestamps', () => {
    // Run the same ticks at two different wall-clock moments. If the engine
    // consulted Date.now() anywhere, these would differ.
    const first = observeTicks(ticks);
    const busy = Date.now() + 5;
    while (Date.now() < busy) {
      /* deliberate wall-clock advance between runs */
    }
    expect(observeTicks(ticks)).toEqual(first);
  });
});
