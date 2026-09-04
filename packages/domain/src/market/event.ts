import type { Timestamp } from '../clock.js';
import type { InstrumentId } from './instrument.js';
import type { BasisPoints, PriceMinor } from './money.js';

export type MarketDirection = 'decline' | 'advance';

/**
 * A meaningful transition: the unit a human would actually care about.
 *
 * The critical property is that an event records *what happened*, not what is
 * currently true. It carries the prices it moved between and the instant it
 * occurred, so it remains a complete and truthful statement long after the
 * price has moved on -- including back to where it started (I1).
 *
 * Nothing here is optional and nothing is derived at read time. An event that
 * needed the current price to be interpreted would not survive the user being
 * away, which is the entire product.
 */
export interface MeaningfulMarketEvent {
  readonly instrumentId: InstrumentId;
  readonly direction: MarketDirection;
  /** The reference price the move was measured from. */
  readonly fromPrice: PriceMinor;
  /** The price that crossed the significance threshold. */
  readonly toPrice: PriceMinor;
  /** Size of the move, always positive. Direction carries the sign. */
  readonly magnitudeBps: BasisPoints;
  readonly occurredAt: Timestamp;
}
