import { describe, expect, it } from 'vitest';
import { instrumentId } from './instrument.js';
import { rupees } from './money.js';
import type { MeaningfulMarketEvent } from './event.js';
import { append, emptySequence, recordsAfter } from './log.js';

const ACME = instrumentId('ACME');

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
    const log = append(emptySequence, [event(900, 1), event(500, 2), event(700, 3)]);
    expect(log.records.map((r) => r.sequence)).toEqual([1, 2, 3]);
    expect(log.head).toBe(3);
  });

  it('continues numbering across separate appends', () => {
    const first = append(emptySequence, [event(900, 1)]);
    const second = append(first, [event(500, 2)]);
    expect(second.records.map((r) => r.sequence)).toEqual([1, 2]);
  });

  it('returns the same log unchanged when appending nothing', () => {
    const log = append(emptySequence, [event(900, 1)]);
    expect(append(log, [])).toBe(log);
  });

  it('reads everything after a given position', () => {
    const log = append(emptySequence, [event(900, 1), event(500, 2), event(700, 3)]);
    expect(recordsAfter(log, 1).map((r) => r.sequence)).toEqual([2, 3]);
    expect(recordsAfter(log, 3)).toHaveLength(0);
  });
});

describe('I2: history is append-only', () => {
  it('leaves the previous sequence untouched when appending', () => {
    const first = append(emptySequence, [event(900, 1)]);
    const snapshot = structuredClone(first);
    append(first, [event(500, 2)]);
    expect(first).toEqual(snapshot);
    expect(first.head).toBe(1);
  });

  it('never reuses a sequence number, even after many appends', () => {
    let log = emptySequence;
    for (let i = 1; i <= 25; i += 1) {
      log = append(log, [event(600, i)]);
    }
    const sequences = log.records.map((r) => r.sequence);
    expect(new Set(sequences).size).toBe(25);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it('rejects mutation of a record at runtime, not just in the type system', () => {
    const log = append(emptySequence, [event(900, 1)]);
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
    const log = append(emptySequence, [event(900, 1)]);
    const readEarlier = log.records;
    append(log, [event(500, 2)]);
    expect(readEarlier).toHaveLength(1);
  });
});
