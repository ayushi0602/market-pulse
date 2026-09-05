import { describe, expect, it } from 'vitest';
import { instrumentId } from './instrument.js';
import { rupees } from './money.js';
import { classifySignal, OUTLIER_FACTOR, type SignalClassification } from './signal-context.js';
import type { MeaningfulMarketEvent } from './event.js';

const STOCK = instrumentId('RELIANCE');
const INDEX = instrumentId('NIFTY');
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

function event(
  overrides: Partial<MeaningfulMarketEvent> & Pick<MeaningfulMarketEvent, 'occurredAt'>,
): MeaningfulMarketEvent {
  return {
    instrumentId: STOCK,
    direction: 'decline',
    fromPrice: rupees(1000),
    toPrice: rupees(930),
    magnitudeBps: 700,
    ...overrides,
  };
}

describe('classifySignal: is this specific to the instrument, or wider?', () => {
  it('calls it stock-specific when the benchmark has no recorded move at all', () => {
    const move = event({ occurredAt: T0 });
    expect(classifySignal(move, [])).toBe('stock-specific');
  });

  it('calls it market-wide when the benchmark moved the same way by a similar amount', () => {
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 700 });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'decline',
      magnitudeBps: 650,
    });
    expect(classifySignal(move, [benchmark])).toBe('market-wide');
  });

  it('calls it stock-specific when the benchmark moved the other way', () => {
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 700 });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'advance',
      magnitudeBps: 700,
    });
    // A market moving up while this instrument falls is exactly the case that
    // must not be folded into "market-wide" -- it is the opposite claim.
    expect(classifySignal(move, [benchmark])).toBe('stock-specific');
  });

  it('calls it an outlier when the move is much larger than the benchmark, same direction', () => {
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 900 });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'decline',
      magnitudeBps: 500,
    });
    // 900 > 500 * OUTLIER_FACTOR (750), so this is amplified, not merely wide.
    expect(classifySignal(move, [benchmark])).toBe('outlier');
  });

  it('treats the OUTLIER_FACTOR boundary as inclusive of market-wide, not outlier', () => {
    const benchmarkMagnitude = 500;
    const move = event({
      occurredAt: T0,
      direction: 'decline',
      magnitudeBps: Math.round(benchmarkMagnitude * OUTLIER_FACTOR),
    });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'decline',
      magnitudeBps: benchmarkMagnitude,
    });
    expect(classifySignal(move, [benchmark])).toBe('market-wide');
  });

  it('counts a benchmark move at the exact same instant, not only strictly before', () => {
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 700 });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0,
      direction: 'decline',
      magnitudeBps: 680,
    });
    expect(classifySignal(move, [benchmark])).toBe('market-wide');
  });

  it('picks the most recent benchmark event at or before this one, not just any', () => {
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 700 });
    const stale = event({
      instrumentId: INDEX,
      occurredAt: T0 - 2 * HOUR,
      direction: 'advance',
      magnitudeBps: 900,
    });
    const current = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'decline',
      magnitudeBps: 650,
    });
    expect(classifySignal(move, [stale, current])).toBe('market-wide');
  });
});

describe('SC1: classification cannot see the future', () => {
  it('is unchanged by a benchmark event that happens after the one being classified', () => {
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 700 });

    const withoutFuture = classifySignal(move, []);

    // A benchmark move recorded an hour *later*, in the same direction and at
    // a magnitude that would flip the verdict to market-wide if it were
    // wrongly counted. This is the case a naive "does any benchmark event
    // match" implementation would get wrong -- and the one "replay must use
    // historical context, not current context" is really asking for.
    const future = event({
      instrumentId: INDEX,
      occurredAt: T0 + HOUR,
      direction: 'decline',
      magnitudeBps: 720,
    });
    const withFuture = classifySignal(move, [future]);

    expect(withFuture).toBe(withoutFuture);
    expect(withFuture).toBe('stock-specific');
  });

  it('gives the identical verdict whether the future event is present in the array or not', () => {
    // Not a property of one example: the function's own filter is what
    // guarantees this, so it holds for every classification, not only decline.
    const move = event({ occurredAt: T0, direction: 'advance', magnitudeBps: 600 });
    const past = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'advance',
      magnitudeBps: 580,
    });
    const future = event({
      instrumentId: INDEX,
      occurredAt: T0 + 1,
      direction: 'decline',
      magnitudeBps: 5000,
    });

    const verdict: SignalClassification = classifySignal(move, [past]);
    expect(classifySignal(move, [past, future])).toBe(verdict);
  });
});

describe('purity', () => {
  it('produces the same verdict for the same inputs, every time', () => {
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 700 });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'decline',
      magnitudeBps: 650,
    });
    const first = classifySignal(move, [benchmark]);
    for (let i = 0; i < 5; i += 1) {
      expect(classifySignal(move, [benchmark])).toBe(first);
    }
  });

  it('does not mutate the arrays it is given', () => {
    const move = event({ occurredAt: T0 });
    const benchmarks = Object.freeze([event({ instrumentId: INDEX, occurredAt: T0 - 1 })]);
    expect(() => classifySignal(move, benchmarks)).not.toThrow();
  });
});
