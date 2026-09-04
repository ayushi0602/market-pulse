import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock } from './clock.js';

describe('clock', () => {
  it('fixedClock reports the same instant on every read', () => {
    const clock = fixedClock(1_700_000_000_000);
    expect(clock.now()).toBe(1_700_000_000_000);
    expect(clock.now()).toBe(1_700_000_000_000);
  });

  it('systemClock reports a plausible current time', () => {
    expect(systemClock.now()).toBeGreaterThan(1_600_000_000_000);
  });
});
