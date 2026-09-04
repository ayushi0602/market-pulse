import { describe, expect, it } from 'vitest';
import { instrumentId } from './instrument.js';
import { rupees } from './money.js';
import type { MeaningfulMarketEvent } from './event.js';
import { append, emptySequence, recordsAfter } from './log.js';
import { sequentialIds } from './event-id.js';

const ACME = instrumentId('ACME');
const ids = sequentialIds();

function event(magnitudeBps: number, at: number): MeaningfulMarketEvent {
  return {
    instrumentId: ACME,
    direction: magnitudeBps < 0 ? 'decline' : 'advance',
    fromPrice: rupees(100),
    toPrice: rupees(91),
    magnitudeBps: Math.abs(magnitudeBps),
    occurredAt: at,
  };
}

describe('event sequence', () => {
  it('assigns 1-based, strictly increasing sequence numbers', () => {
    const log = append(emptySequence, [event(900, 1), event(500, 2), event(700, 3)], ids);
    expect(log.records.map((r) => r.sequence)).toEqual([1, 2, 3]);
    expect(log.head).toBe(3);
  });

  it('continues numbering across separate appends', () => {
    const first = append(emptySequence, [event(900, 1)], ids);
    const second = append(first, [event(500, 2)], ids);
    expect(second.records.map((r) => r.sequence)).toEqual([1, 2]);
  });

  it('returns the same log unchanged when appending nothing', () => {
    const log = append(emptySequence, [event(900, 1)], ids);
    expect(append(log, [], ids)).toBe(log);
  });

  it('reads everything after a given position', () => {
    const log = append(emptySequence, [event(900, 1), event(500, 2), event(700, 3)], ids);
    expect(recordsAfter(log, 1).map((r) => r.sequence)).toEqual([2, 3]);
    expect(recordsAfter(log, 3)).toHaveLength(0);
  });
});

describe('I2: history is append-only', () => {
  it('leaves the previous sequence untouched when appending', () => {
    const first = append(emptySequence, [event(900, 1)], ids);
    const snapshot = structuredClone(first);
    append(first, [event(500, 2)], ids);
    expect(first).toEqual(snapshot);
    expect(first.head).toBe(1);
  });

  it('never reuses a sequence number, even after many appends', () => {
    let log = emptySequence;
    for (let i = 1; i <= 25; i += 1) {
      log = append(log, [event(600, i)], ids);
    }
    const sequences = log.records.map((r) => r.sequence);
    expect(new Set(sequences).size).toBe(25);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it('rejects mutation of a record at runtime, not just in the type system', () => {
    const log = append(emptySequence, [event(900, 1)], ids);
    const record = log.records[0];
    expect(record).toBeDefined();
    // ESM modules are strict mode, so writing to a frozen object throws rather
    // than failing silently. The readonly types are a compile-time guard; this
    // is the runtime one.
    expect(() => {
      (record as unknown as { sequence: number }).sequence = 99;
    }).toThrow(TypeError);
    expect(() => {
      (log.records as unknown as MeaningfulMarketEvent[]).push(event(100, 9));
    }).toThrow(TypeError);
  });

  it('keeps an already-read view valid after new events arrive', () => {
    // The read side is only correct if what it read cannot be rewritten
    // underneath it.
    const log = append(emptySequence, [event(900, 1)], ids);
    const readEarlier = log.records;
    append(log, [event(500, 2)], ids);
    expect(readEarlier).toHaveLength(1);
  });
});

describe('identity is not ordering', () => {
  it('assigns a distinct id and a distinct position to each record', () => {
    const source = sequentialIds('e');
    const log = append(emptySequence, [event(900, 1), event(500, 2)], source);

    expect(log.records.map((r) => r.eventId)).toEqual(['e-1', 'e-2']);
    expect(log.records.map((r) => r.sequence)).toEqual([1, 2]);
  });

  it('gives the same event different positions in different logs', () => {
    // Identity travels with the event; position belongs to the log it sits in.
    // A model that used one value for both could not express this.
    const shared = event(900, 1);
    const a = append(emptySequence, [shared], sequentialIds('same'));
    const b = append(append(emptySequence, [event(500, 0)], sequentialIds('other')), [shared], {
      next: () => 'same-1' as never,
    });

    expect(a.records[0]?.eventId).toBe(b.records[1]?.eventId);
    expect(a.records[0]?.sequence).toBe(1);
    expect(b.records[1]?.sequence).toBe(2);
  });

  it('never reuses an id within a source', () => {
    const source = sequentialIds();
    const ids = Array.from({ length: 50 }, () => source.next());
    expect(new Set(ids).size).toBe(50);
  });
});
