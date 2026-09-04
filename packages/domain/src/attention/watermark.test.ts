import { describe, expect, it } from 'vitest';
import { instrumentId } from '../market/instrument.js';
import { rupees } from '../market/money.js';
import type { MeaningfulMarketEvent } from '../market/event.js';
import { append, emptySequence } from '../market/log.js';
import { sequentialIds } from '../market/event-id.js';
import { hasUnread, joiningAt, markRead, newReader, unreadFor } from './watermark.js';
import { userId } from './user.js';

const ACME = instrumentId('ACME');
const ids = sequentialIds();

function event(at: number): MeaningfulMarketEvent {
  return {
    instrumentId: ACME,
    direction: 'decline',
    fromPrice: rupees(100),
    toPrice: rupees(91),
    magnitudeBps: 900,
    occurredAt: at,
  };
}

const log = append(emptySequence, [event(1), event(2), event(3)], ids);

describe('read watermark', () => {
  it('owes the whole log to a reader who has seen nothing', () => {
    expect(unreadFor(newReader(userId('alice')), log)).toHaveLength(3);
    expect(hasUnread(newReader(userId('alice')), log)).toBe(true);
  });

  it('owes nothing to a reader who joined at the current head', () => {
    const carol = joiningAt(userId('carol'), log);
    expect(unreadFor(carol, log)).toHaveLength(0);
    expect(hasUnread(carol, log)).toBe(false);
  });

  it('surfaces only what arrived after the last read', () => {
    const alice = markRead(newReader(userId('alice')), log);
    const grown = append(log, [event(4), event(5)], ids);
    expect(unreadFor(alice, grown).map((r) => r.sequence)).toEqual([4, 5]);
  });

  it('does not advance the watermark as a side effect of reading', () => {
    const alice = newReader(userId('alice'));
    unreadFor(alice, log);
    unreadFor(alice, log);
    // Displaying an event and acknowledging it are different decisions.
    expect(alice.lastSeenSequence).toBe(0);
    expect(unreadFor(alice, log)).toHaveLength(3);
  });

  it('never moves backwards against a stale log', () => {
    const alice = markRead(newReader(userId('alice')), log);
    const stale = append(emptySequence, [event(1)], ids);
    expect(markRead(alice, stale)).toBe(alice);
  });

  it('returns a new watermark rather than mutating the old one', () => {
    const before = newReader(userId('alice'));
    const after = markRead(before, log);
    expect(before.lastSeenSequence).toBe(0);
    expect(after.lastSeenSequence).toBe(3);
    expect(after).not.toBe(before);
  });
});

describe('I4: users consume history independently', () => {
  it('gives two users different answers from the same log', () => {
    const alice = newReader(userId('alice'));
    const bob = markRead(newReader(userId('bob')), log);

    expect(unreadFor(alice, log)).toHaveLength(3);
    expect(unreadFor(bob, log)).toHaveLength(0);
  });

  it('one user reading changes nothing for another', () => {
    const alice = newReader(userId('alice'));
    const bob = newReader(userId('bob'));

    markRead(alice, log);

    expect(bob.lastSeenSequence).toBe(0);
    expect(unreadFor(bob, log)).toHaveLength(3);
  });

  it('one user reading does not consume from the shared log', () => {
    // The log is shared and read-only. Nothing is "taken" from it -- this is
    // what makes it a log rather than a queue.
    const alice = newReader(userId('alice'));
    markRead(alice, log);
    expect(log.records).toHaveLength(3);
    expect(log.head).toBe(3);
  });

  it('lets a late joiner and an away user see different things at the same instant', () => {
    const away = newReader(userId('away'));
    const late = joiningAt(userId('late'), log);
    const grown = append(log, [event(4)], ids);

    // Same log, same moment, different answers. This is the product.
    expect(unreadFor(away, grown).map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
    expect(unreadFor(late, grown).map((r) => r.sequence)).toEqual([4]);
  });
});
