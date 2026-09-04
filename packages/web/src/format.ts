import { paise, toPercent, toRupees } from '@market-pulse/domain';

/**
 * Display helpers.
 *
 * Formatting lives here and nowhere else, so that no component is tempted to do
 * arithmetic on a price. Prices arrive as integer minor units and are converted
 * once, at the edge, for the eye only.
 */

const rupeeFormat = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPrice(minorUnits: number): string {
  return rupeeFormat.format(toRupees(paise(minorUnits)));
}

/** Signed percentage, e.g. "-9.00%". `bps` is unsigned; pass the sign in. */
export function formatPercent(bps: number, signed = true): string {
  const percent = toPercent(bps);
  const sign = signed && percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
