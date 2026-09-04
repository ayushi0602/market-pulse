import { describe, expect, it } from 'vitest';
import { instrumentId } from '../market/instrument.js';
import { rupees } from '../market/money.js';
import { append, emptySequence } from '../market/log.js';
import { sequentialIds } from '../market/event-id.js';
import type { MeaningfulMarketEvent } from '../market/event.js';
import { rankBySignificance } from './ranking.js';

const ACME = instrumentId('ACME');

function event(magnitudeBps: number, occurredAt: number): MeaningfulMarketEvent {
  return {
    instrumentId: ACME,
    direction: 'decline',
    fromPrice: rupees(100),
    toPrice: rupees(91),
    magnitudeBps,
    occurredAt,
  };
}

function logOf(...magnitudes: number[]) {
  return append(
    emptySequence,
    magnitudes.map((m, i) => event(m, i)),
    sequentialIds(),
  ).records;
}

describe('F5: ranking is deterministic', () => {
  it('orders by magnitude, largest first', () => {
    const ranked = rankBySignificance(logOf(300, 900, 500));
    expect(ranked.map((r) => r.event.magnitudeBps)).toEqual([900, 500, 300]);
  });

  it('breaks ties toward the newer event', () => {
    const ranked = rankBySignificance(logOf(500, 500, 500));
    expect(ranked.map((r) => r.sequence)).toEqual([3, 2, 1]);
  });

  it('gives the same order for the same input, every time', () => {
    const records = logOf(300, 900, 500, 900, 100);
    const runs = Array.from({ length: 50 }, () => rankBySignificance(records));
    for (const run of runs) {
      expect(run.map((r) => r.sequence)).toEqual(runs[0]?.map((r) => r.sequence));
    }
  });

  it('does not depend on the order it was handed', () => {
    const records = logOf(300, 900, 500, 700);
    const shuffled = [records[2], records[0], records[3], records[1]].filter(
      (r) => r !== undefined,
    );
    expect(rankBySignificance(records).map((r) => r.sequence)).toEqual(
      rankBySignificance(shuffled).map((r) => r.sequence),
    );
  });

  it('does not mutate the input', () => {
    const records = logOf(300, 900, 500);
    const before = records.map((r) => r.sequence);
    rankBySignificance(records);
    expect(records.map((r) => r.sequence)).toEqual(before);
  });

  it('handles an empty feed', () => {
    expect(rankBySignificance([])).toEqual([]);
  });
});
