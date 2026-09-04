/**
 * Prices, held as integer minor units (paise for INR).
 *
 * Never floating point. `0.1 + 0.2 !== 0.3`, and a significance engine that
 * compares prices cannot afford representation error: two runs over the same
 * ticks must produce byte-identical events (I3), and a threshold comparison
 * that lands a fraction of a paisa either side of the line would decide whether
 * a user is told about a 5% move.
 *
 * The brand exists so a raw `number` cannot be passed where a price is
 * expected. It costs nothing at runtime and makes the unit part of the type.
 */
declare const priceBrand: unique symbol;
export type PriceMinor = number & { readonly [priceBrand]: 'PriceMinor' };

/**
 * Change expressed in basis points: 100 bps = 1%, 900 bps = 9%.
 *
 * Percentages of integers are not integers, so magnitude is carried in the
 * smallest unit anyone quotes rather than as a float. Positive is a rise.
 */
export type BasisPoints = number;

const MINOR_UNITS_PER_MAJOR = 100;
const BASIS_POINTS_PER_UNIT = 10_000;

/** A price from a whole number of minor units (paise). */
export function paise(value: number): PriceMinor {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Price must be a whole number of minor units, got ${value}`);
  }
  if (value < 0) {
    throw new RangeError(`Price cannot be negative, got ${value}`);
  }
  return value as PriceMinor;
}

/**
 * A price from major units (rupees). Convenience for tests and fixtures, where
 * writing 10_000 for ₹100 obscures the scenario being described.
 */
export function rupees(value: number): PriceMinor {
  const minor = Math.round(value * MINOR_UNITS_PER_MAJOR);
  if (Math.abs(value * MINOR_UNITS_PER_MAJOR - minor) > 1e-6) {
    throw new RangeError(`Price has sub-paisa precision that cannot be stored: ${value}`);
  }
  return paise(minor);
}

/** Formats a price as major units, for display and test failure messages. */
export function toRupees(price: PriceMinor): number {
  return price / MINOR_UNITS_PER_MAJOR;
}

/**
 * The move from one price to another, in basis points.
 *
 * Integer arithmetic throughout, and `Math.round` is deterministic, so the same
 * pair always yields the same answer on every machine and every run (I3).
 */
export function changeInBasisPoints(from: PriceMinor, to: PriceMinor): BasisPoints {
  if (from <= 0) {
    throw new RangeError('Cannot express a change relative to a zero price');
  }
  return Math.round(((to - from) * BASIS_POINTS_PER_UNIT) / from);
}

/** Basis points as a percentage, for display only. Never compared against. */
export function toPercent(bps: BasisPoints): number {
  return bps / 100;
}
