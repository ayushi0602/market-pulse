import { describe, expect, it } from 'vitest';
import { instrumentId } from '../market/instrument.js';
import { rupees, toPercent, toRupees } from '../market/money.js';
import { append, emptySequence } from '../market/log.js';
import { sequentialIds } from '../market/event-id.js';
import { observeTicks } from '../market/significance.js';
import type { MarketTick } from '../market/tick.js';
import {
  advance,
  createReplay,
  isComplete,
  netChangeAtCursor,
  openingPrice,
  priceAtCursor,
  restart,
  revealed,
} from './replay.js';

/** Narrows away `undefined` by failing loudly, rather than with a non-null assertion. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${what} to be present`);
  }
  return value;
}

const RELIANCE = instrumentId('RELIANCE');
const START = 1_700_000_000_000;

const goldenTicks: MarketTick[] = [100, 96, 91, 95, 100].map((price, index) => ({
  instrumentId: RELIANCE,
  price: rupees(price),
  at: START + index * 60_000,
}));

function goldenRecords() {
  return append(emptySequence, observeTicks(goldenTicks).events, sequentialIds()).records;
}

function stepAll(records = goldenRecords()) {
  let replay = createReplay(records);
  const seen = [replay];
  while (!isComplete(replay)) {
    replay = advance(replay);
    seen.push(replay);
  }
  return seen;
}

describe('replaying the golden scenario', () => {
  it('starts before anything has happened', () => {
    const replay = createReplay(goldenRecords());
    expect(replay.cursor).toBe(0);
    expect(revealed(replay)).toHaveLength(0);
    expect(toRupees(openingPrice(replay) ?? rupees(0))).toBe(100);
    expect(netChangeAtCursor(replay)).toBe(0);
  });

  it('tells the story one step at a time', () => {
    const states = stepAll();
    const afterFall = required(states[1], 'the state after the fall');
    const afterRecovery = required(states[2], 'the state after the recovery');

    expect(revealed(afterFall)).toHaveLength(1);
    expect(afterFall.timeline[0]?.event.direction).toBe('decline');
    expect(toRupees(required(priceAtCursor(afterFall), 'a price'))).toBe(91);
    expect(toPercent(netChangeAtCursor(afterFall))).toBe(-9);

    expect(revealed(afterRecovery)).toHaveLength(2);
    expect(toRupees(required(priceAtCursor(afterRecovery), 'a price'))).toBe(100);
    // Back to where it started -- and both events are still revealed.
    expect(netChangeAtCursor(afterRecovery)).toBe(0);
  });

  it('ends with a story told and a price that went nowhere', () => {
    const final = required(stepAll().at(-1), 'the final state');
    expect(isComplete(final)).toBe(true);
    expect(revealed(final)).toHaveLength(2);
    expect(netChangeAtCursor(final)).toBe(0);
    expect(priceAtCursor(final)).toBe(openingPrice(final));
  });

  it('stops at the end rather than running off it', () => {
    const final = required(stepAll().at(-1), 'the final state');
    expect(advance(final)).toBe(final);
    expect(advance(advance(final)).cursor).toBe(2);
  });

  it('restarts to the beginning', () => {
    const final = required(stepAll().at(-1), 'the final state');
    const again = restart(final);
    expect(again.cursor).toBe(0);
    expect(revealed(again)).toHaveLength(0);
    expect(restart(again)).toBe(again);
  });
});

describe('R1: replay cannot rewrite history', () => {
  it('does not mutate the records it was given', () => {
    const records = goldenRecords();
    const before = structuredClone([...records]);
    stepAll(records);
    expect([...records]).toEqual(before);
  });

  it('freezes its own timeline', () => {
    const replay = createReplay(goldenRecords());
    expect(() => {
      (replay.timeline as unknown as unknown[]).push({});
    }).toThrow(TypeError);
    expect(() => {
      (replay as unknown as { cursor: number }).cursor = 99;
    }).toThrow(TypeError);
  });

  it('leaves every earlier state valid as the cursor moves', () => {
    const states = stepAll();
    const first = required(states[0], 'the initial state');
    expect(first.cursor).toBe(0);
    expect(revealed(first)).toHaveLength(0);
  });
});

describe('R2: replay is deterministic', () => {
  it('produces the same visible state for the same events and cursor', () => {
    const records = goldenRecords();
    const runs = Array.from({ length: 30 }, () => stepAll(records).map((r) => revealed(r)));
    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });

  it('does not depend on the order records were handed in', () => {
    const records = goldenRecords();
    const shuffled = [...records].reverse();
    expect(createReplay(shuffled).timeline).toEqual(createReplay(records).timeline);
  });
});

describe('R3: replay follows sequence order, not timestamps', () => {
  it('orders by sequence when timestamps collide', () => {
    // Two events at the same instant. Timestamp ordering cannot separate them;
    // sequence can, and it is the order they were recorded in.
    const sameInstant = [100, 91, 100].map((price) => ({
      instrumentId: RELIANCE,
      price: rupees(price),
      at: START,
    }));
    const records = append(
      emptySequence,
      observeTicks(sameInstant).events,
      sequentialIds(),
    ).records;

    expect(records.map((r) => r.event.occurredAt)).toEqual([START, START]);
    expect(createReplay(records).timeline.map((r) => r.sequence)).toEqual([1, 2]);
  });

  it('ignores timestamps that disagree with recorded order', () => {
    const records = goldenRecords();
    // A record whose timestamp is older than its predecessor's must still
    // replay in the order it was recorded.
    const second = required(records[1], 'the second record');
    const outOfOrder = [
      { ...second, event: { ...second.event, occurredAt: START - 1_000_000 } },
      required(records[0], 'the first record'),
    ];
    expect(createReplay(outOfOrder).timeline.map((r) => r.sequence)).toEqual([1, 2]);
  });
});

describe('an empty history', () => {
  it('replays as an immediately complete, empty story', () => {
    const replay = createReplay([]);
    expect(isComplete(replay)).toBe(true);
    expect(openingPrice(replay)).toBeUndefined();
    expect(netChangeAtCursor(replay)).toBe(0);
    expect(advance(replay)).toBe(replay);
  });
});
