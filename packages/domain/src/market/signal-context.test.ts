import { describe, expect, it } from 'vitest';
import { instrumentId } from './instrument.js';
import { rupees } from './money.js';
import { classifySignal, OUTLIER_FACTOR } from './signal-context.js';
import type { SignalClassification } from './signal-context.js';
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

describe('the outlier boundary, on both sides', () => {
  it('classifies just below the boundary as market-wide, not outlier', () => {
    const benchmarkMagnitude = 500;
    const justBelow = Math.floor(benchmarkMagnitude * OUTLIER_FACTOR) - 1; // 749
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: justBelow });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'decline',
      magnitudeBps: benchmarkMagnitude,
    });
    expect(classifySignal(move, [benchmark])).toBe('market-wide');
  });

  it('classifies just above the boundary as an outlier, not market-wide', () => {
    const benchmarkMagnitude = 500;
    const justAbove = Math.ceil(benchmarkMagnitude * OUTLIER_FACTOR) + 1; // 751
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: justAbove });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'decline',
      magnitudeBps: benchmarkMagnitude,
    });
    expect(classifySignal(move, [benchmark])).toBe('outlier');
  });
});

describe('every direction/magnitude combination', () => {
  const cases: {
    stockDirection: MeaningfulMarketEvent['direction'];
    stockBps: number;
    benchmarkDirection: MeaningfulMarketEvent['direction'];
    benchmarkBps: number;
    expected: SignalClassification;
  }[] = [
    // stock -7%, benchmark -4%: same direction, 700/400 = 1.75x -> outlier
    {
      stockDirection: 'decline',
      stockBps: 700,
      benchmarkDirection: 'decline',
      benchmarkBps: 400,
      expected: 'outlier',
    },
    // stock -4%, benchmark -7%: same direction, 400/700 well under 1.5x -> market-wide
    {
      stockDirection: 'decline',
      stockBps: 400,
      benchmarkDirection: 'decline',
      benchmarkBps: 700,
      expected: 'market-wide',
    },
    // stock +7%, benchmark +4%: same direction, 1.75x -> outlier
    {
      stockDirection: 'advance',
      stockBps: 700,
      benchmarkDirection: 'advance',
      benchmarkBps: 400,
      expected: 'outlier',
    },
    // stock +4%, benchmark +7%: same direction, under 1.5x -> market-wide
    {
      stockDirection: 'advance',
      stockBps: 400,
      benchmarkDirection: 'advance',
      benchmarkBps: 700,
      expected: 'market-wide',
    },
    // stock -7%, benchmark +7%: opposite directions -> stock-specific, regardless of equal magnitude
    {
      stockDirection: 'decline',
      stockBps: 700,
      benchmarkDirection: 'advance',
      benchmarkBps: 700,
      expected: 'stock-specific',
    },
    // stock +7%, benchmark -7%: opposite directions -> stock-specific
    {
      stockDirection: 'advance',
      stockBps: 700,
      benchmarkDirection: 'decline',
      benchmarkBps: 700,
      expected: 'stock-specific',
    },
  ];

  it.each(cases)(
    'stock $stockDirection $stockBps vs benchmark $benchmarkDirection $benchmarkBps -> $expected',
    ({ stockDirection, stockBps, benchmarkDirection, benchmarkBps, expected }) => {
      const move = event({ occurredAt: T0, direction: stockDirection, magnitudeBps: stockBps });
      const benchmark = event({
        instrumentId: INDEX,
        occurredAt: T0 - 1,
        direction: benchmarkDirection,
        magnitudeBps: benchmarkBps,
      });
      expect(classifySignal(move, [benchmark])).toBe(expected);
    },
  );
});

describe('degenerate benchmark magnitudes do not produce NaN, Infinity, or a crash', () => {
  it('handles a benchmark event with zero magnitude without dividing by anything', () => {
    // classifySignal never divides -- it multiplies the benchmark's magnitude
    // by OUTLIER_FACTOR and compares -- so there is no operation here that can
    // produce NaN or Infinity even in a degenerate case the real engine would
    // never emit (magnitudeBps is always >= the threshold in practice).
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 600 });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'decline',
      magnitudeBps: 0,
    });
    const result = classifySignal(move, [benchmark]);
    expect(['market-wide', 'outlier', 'stock-specific']).toContain(result);
    expect(result).toBe('outlier'); // any real move exceeds a benchmark of zero
  });

  it('handles a tiny (1 bps) benchmark and a tiny stock move the same way', () => {
    const move = event({ occurredAt: T0, direction: 'advance', magnitudeBps: 1 });
    const benchmark = event({
      instrumentId: INDEX,
      occurredAt: T0 - 1,
      direction: 'advance',
      magnitudeBps: 1,
    });
    expect(classifySignal(move, [benchmark])).toBe('market-wide');
  });
});

describe('a benchmark with gaps, or one that starts after the stock event', () => {
  it('falls back to stock-specific when the benchmark only starts after this event', () => {
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 700 });
    const startsLate = event({
      instrumentId: INDEX,
      occurredAt: T0 + HOUR,
      direction: 'decline',
      magnitudeBps: 700,
    });
    expect(classifySignal(move, [startsLate])).toBe('stock-specific');
  });

  it('uses the most recent benchmark event before a gap, not one from further back', () => {
    const move = event({ occurredAt: T0 + 5 * HOUR, direction: 'decline', magnitudeBps: 700 });
    const early = event({
      instrumentId: INDEX,
      occurredAt: T0,
      direction: 'advance',
      magnitudeBps: 900,
    });
    // A gap in the benchmark's own history -- e.g. a quiet period -- between
    // `early` and the event just before `move`.
    const beforeGap = event({
      instrumentId: INDEX,
      occurredAt: T0 + 4 * HOUR,
      direction: 'decline',
      magnitudeBps: 650,
    });
    expect(classifySignal(move, [early, beforeGap])).toBe('market-wide');
  });
});

describe('a tie in benchmark timestamps is resolved deterministically', () => {
  it('gives the same verdict regardless of the order two simultaneous benchmark events are passed in', () => {
    const move = event({ occurredAt: T0, direction: 'decline', magnitudeBps: 700 });
    const a = event({
      instrumentId: INDEX,
      occurredAt: T0,
      direction: 'decline',
      magnitudeBps: 650,
    });
    const b = event({
      instrumentId: INDEX,
      occurredAt: T0,
      direction: 'decline',
      magnitudeBps: 680,
    });
    expect(classifySignal(move, [a, b])).toBe(classifySignal(move, [b, a]));
  });
});
