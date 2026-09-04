import type { MarketDirection } from '../market/event.js';

/**
 * Wire contracts for the attention feed.
 *
 * Separate from the internal domain types on purpose, so a domain refactor does
 * not silently reshape the public API. Prices cross the wire as integer minor
 * units and magnitudes as basis points -- the same representation the domain
 * and the database use, so no boundary in the system reintroduces a float.
 *
 * Two shapes deliberately match the domain rather than the usual API idiom:
 * `instrumentId` rather than `symbol`, and a positive `magnitudeBps` paired with
 * a `direction` rather than a signed number. Renaming across the boundary buys
 * translation bugs and nothing else, and a signed magnitude would make
 * "how big" and "which way" the same field again.
 */

export interface FeedEvent {
  readonly eventId: string;
  /** Position in the shared log. What the client acknowledges. */
  readonly sequence: number;
  readonly instrumentId: string;
  readonly direction: MarketDirection;
  /** Anchor the move was measured from, in minor units. */
  readonly fromPrice: number;
  /** Price at the threshold crossing, in minor units. */
  readonly toPrice: number;
  /** Always positive. `direction` carries the sign. */
  readonly magnitudeBps: number;
  readonly occurredAt: number;
}

export interface FeedInstrumentSummary {
  readonly instrumentId: string;
  readonly priceWhenLastSeen: number;
  /** Latest price *as recorded in the log*, not necessarily the live price. */
  readonly latestPrice: number;
  /** What a snapshot watchlist would report. Often 0 when the feed is not empty. */
  readonly netChangeBps: number;
  readonly meaningfulChanges: number;
}

export interface AttentionFeedResponse {
  readonly userId: string;
  /** The user's watermark at the time of this read. Unchanged by reading it. */
  readonly sinceSequence: number;
  /** The log head at the time of this read. What the client would acknowledge. */
  readonly throughSequence: number;
  readonly summary: {
    readonly meaningfulChanges: number;
    readonly instruments: readonly FeedInstrumentSummary[];
  };
  /** Ranked by significance, largest first. Not chronological. */
  readonly events: readonly FeedEvent[];
}

export interface AcknowledgeRequest {
  readonly userId: string;
  readonly throughSequence: number;
}

export interface AcknowledgeResponse {
  readonly userId: string;
  /** Where the watermark actually ended up. Never lower than it was. */
  readonly lastSeenSequence: number;
}
