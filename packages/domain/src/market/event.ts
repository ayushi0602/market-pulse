import type { Timestamp } from '../clock.js';
import type { InstrumentId } from './instrument.js';
import type { BasisPoints, PriceMinor } from './money.js';

/**
 * Which way an anchor-relative move crossed the threshold.
 *
 * - `decline` — a downward move from the active anchor reached the threshold.
 * - `advance` — an upward move from the active anchor reached the threshold.
 *
 * Symmetric by construction: neither direction is "the correction" of the
 * other. A fall and a subsequent recovery are two things that happened.
 */
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
 *
 * ## What this event is, precisely
 *
 * **A threshold-crossing move, measured from the anchor that was active when it
 * crossed.** It is deliberately *not* "the full move" of a price run, and must
 * not be described as one.
 *
 * The difference is observable. A fall of 100 -> 94 -> 91 emits a single event
 * reading `decline, 100 -> 94, 600 bps`: the drop to 94 crossed the threshold
 * and re-anchored there, and the further fall to 91 is only 3.2% from the new
 * anchor. The real path was a 9% fall; the event records the 6% that crossed.
 *
 * Both statements are true, and the event's is the narrower one. Any wording
 * built on this type -- UI copy, notifications, summaries -- must not promise
 * more than the event contains. Aggregating a run of events into "fell 9%" is a
 * presentation concern, and needs the whole run, not one record.
 */
export interface MeaningfulMarketEvent {
  readonly instrumentId: InstrumentId;
  readonly direction: MarketDirection;
  /**
   * The anchor the move was measured from -- the reference that was active when
   * this event fired, not the previous tick and not the session open.
   *
   * For the first event in a run this is where the price was resting. For every
   * event after it, this is the price at which the *previous* event fired, since
   * emission re-anchors. So for an `advance` following a `decline`, `fromPrice`
   * is the trough the recovery began from.
   */
  readonly fromPrice: PriceMinor;
  /**
   * The price at the tick that crossed the threshold, which becomes the next
   * anchor. Not the extreme of the run -- the run may continue past it without
   * producing another event until the threshold is met again.
   */
  readonly toPrice: PriceMinor;
  /** Size of the move, always positive. Direction carries the sign. */
  readonly magnitudeBps: BasisPoints;
  readonly occurredAt: Timestamp;
}
