import { describe, expect, it } from 'vitest';
import { changeInBasisPoints, paise, rupees, toPercent, toRupees } from './money.js';

describe('prices are integer minor units', () => {
  it('converts major units without floating point drift', () => {
    expect(rupees(100)).toBe(10_000);
    expect(rupees(91.5)).toBe(9_150);
    expect(toRupees(rupees(91.5))).toBe(91.5);
  });

  it('refuses precision it cannot store rather than rounding silently', () => {
    expect(() => rupees(1.005)).toThrow(/sub-paisa/);
    expect(() => paise(10.5)).toThrow(/whole number/);
    expect(() => paise(-1)).toThrow(/negative/);
  });

  it('survives the arithmetic that breaks floats', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is exact.
    expect(rupees(0.1) + rupees(0.2)).toBe(rupees(0.3));
  });
});

describe('changeInBasisPoints', () => {
  it('measures a decline and a rise from the same pair consistently', () => {
    expect(changeInBasisPoints(rupees(100), rupees(91))).toBe(-900);
    expect(changeInBasisPoints(rupees(91), rupees(100))).toBe(989);
  });

  it('is zero for no movement', () => {
    expect(changeInBasisPoints(rupees(100), rupees(100))).toBe(0);
  });

  it('converts to the percentage a human would be shown', () => {
    expect(toPercent(-900)).toBe(-9);
    expect(toPercent(989)).toBe(9.89);
  });

  it('rejects a zero reference price instead of returning Infinity', () => {
    expect(() => changeInBasisPoints(paise(0), rupees(100))).toThrow(/zero price/);
  });

  it('is deterministic: the same inputs always give the same answer', () => {
    const results = Array.from({ length: 100 }, () =>
      changeInBasisPoints(rupees(1234.56), rupees(1111.11)),
    );
    expect(new Set(results).size).toBe(1);
  });
});
