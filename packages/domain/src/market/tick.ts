import type { Timestamp } from '../clock.js';
import type { InstrumentId } from './instrument.js';
import type { PriceMinor } from './money.js';

/**
 * A raw observation of an instrument at an instant.
 *
 * Ticks are *input*, not history. They are high volume and individually
 * meaningless -- nobody wants to be told that a price moved by four paise.
 * History is what the significance engine derives from them.
 */
export interface MarketTick {
  readonly instrumentId: InstrumentId;
  readonly price: PriceMinor;
  readonly at: Timestamp;
}
