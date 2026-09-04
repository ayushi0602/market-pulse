import { describe, expect, it } from 'vitest';
import { instrumentId } from './market/instrument.js';
import { rupees, toPercent, toRupees } from './market/money.js';
import type { MarketTick } from './market/tick.js';
import { observeTicks } from './market/significance.js';
import { append, emptySequence } from './market/log.js';
import { sequentialIds } from './market/event-id.js';
import { joiningAt, markRead, unreadFor } from './attention/watermark.js';
import { userId } from './attention/user.js';

/**
 * The signature test.
 *
 * A user last looked when the price was Rs 100. While they were away it fell to
 * Rs 91 and came back to Rs 100. A watchlist that compares the current price
 * against the last snapshot reports "no change" -- truthfully, and uselessly.
 *
 * This test asserts that Market Pulse still tells them what they missed. Every
 * other piece of the domain exists to make this one behaviour true.
 */

/**
 * Narrows away `undefined` by failing loudly instead of with `!`.
 *
 * `noUncheckedIndexedAccess` makes every array index possibly-undefined, which
 * is correct. Silencing that with a non-null assertion in a test would mean a
 * missing element surfaces as a confusing property-access error rather than as
 * the assertion that actually failed.
 */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${what} to be present`);
  }
  return value;
}

const RELIANCE = instrumentId('RELIANCE');
const MINUTE = 60_000;
const START = 1_700_000_000_000;

function tickAt(minute: number, price: number): MarketTick {
  return { instrumentId: RELIANCE, price: rupees(price), at: START + minute * MINUTE };
}

describe('golden scenario: the price returns, the history does not', () => {
  // 100 -> 96 -> 91 -> 95 -> 100. The user sees the first and last price only.
  const ticks = [tickAt(0, 100), tickAt(1, 96), tickAt(2, 91), tickAt(3, 95), tickAt(4, 100)];

  const alice = userId('alice');

  function replay() {
    const { state, events } = observeTicks(ticks);
    // Deterministic ids: the scenario must produce byte-identical output on
    // every run, so nothing here may reach for randomness.
    const log = append(emptySequence, events, sequentialIds());
    return { state, events, log };
  }

  it('a snapshot comparison would report nothing at all', () => {
    // This is the premise, not an aspiration: the naive answer really is "no
    // change". If this ever fails, the scenario no longer proves anything.
    const first = required(ticks[0], 'the first tick');
    const last = required(ticks[ticks.length - 1], 'the last tick');
    expect(first.price).toBe(last.price);
  });

  it('surfaces the decline the user missed, even though the price recovered', () => {
    const { log } = replay();

    // The user was last here at the opening price, before anything happened.
    const watermark = { userId: alice, lastSeenSequence: 0 };
    const missed = unreadFor(watermark, log);

    expect(missed.length).toBeGreaterThan(0);

    const decline = required(
      missed.find((record) => record.event.direction === 'decline'),
      'a decline event',
    ).event;
    expect(toRupees(decline.fromPrice)).toBe(100);
    expect(toRupees(decline.toPrice)).toBe(91);
    expect(toPercent(decline.magnitudeBps)).toBe(9);
    expect(decline.occurredAt).toBe(START + 2 * MINUTE);
  });

  it('reports the recovery as its own event rather than erasing the decline', () => {
    const { log } = replay();
    const missed = unreadFor({ userId: alice, lastSeenSequence: 0 }, log);

    expect(missed.map((record) => record.event.direction)).toEqual(['decline', 'advance']);

    // The recovery is measured from the trough it recovered from, not from the
    // original price -- it is a separate thing that happened, not a correction.
    const advance = required(missed[1], 'the recovery event').event;
    expect(toRupees(advance.fromPrice)).toBe(91);
    expect(toRupees(advance.toPrice)).toBe(100);
  });

  it('I1: the events do not depend on where the price ended up', () => {
    const { state, log } = replay();

    // Final price is identical to the opening price...
    expect(required(state, 'final state').lastPrice).toBe(required(ticks[0], 'first tick').price);
    // ...and the history is not empty. That is the entire product claim.
    expect(log.records).toHaveLength(2);
  });

  it('a user who was watching the whole time has nothing to catch up on', () => {
    const { log } = replay();

    // Bob acknowledged everything as it happened.
    const bob = markRead({ userId: userId('bob'), lastSeenSequence: 0 }, log);
    expect(unreadFor(bob, log)).toHaveLength(0);

    // Alice, who was away, still sees all of it. Same log, different answer.
    const missed = unreadFor({ userId: alice, lastSeenSequence: 0 }, log);
    expect(missed).toHaveLength(2);
  });

  it('a user joining after the fact is not shown history they were never party to', () => {
    const { log } = replay();
    const carol = joiningAt(userId('carol'), log);
    expect(unreadFor(carol, log)).toHaveLength(0);
  });
});
