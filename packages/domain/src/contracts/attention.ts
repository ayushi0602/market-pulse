import type { MarketDirection } from '../market/event.js';
import type { SignalClassification } from '../market/signal-context.js';

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
  /**
   * Was this specific to the instrument, or part of a wider move?
   *
   * `undefined` for the benchmark instrument's own events -- comparing it
   * against itself would be circular, so the server does not attempt it.
   * Every other event gets a verdict, computed against the benchmark's history
   * at the time this event occurred, never against what the benchmark did
   * afterward.
   */
  readonly signalContext: SignalClassification | undefined;
}

export interface FeedInstrumentSummary {
  readonly instrumentId: string;
  readonly priceWhenLastSeen: number;
  /**
   * The price at the most recent unread *event* — the end of the window this
   * summary describes, not the latest thing the system has observed.
   *
   * `priceWhenLastSeen` -> `latestPrice` -> `netChangeBps` are one coherent
   * statement about the events the user missed. They are not a statement about
   * now: with a market running, ticks continue after the last threshold
   * crossing and none of them are recorded as events.
   */
  readonly latestPrice: number;
  /** What a snapshot watchlist would report. Often 0 when the feed is not empty. */
  readonly netChangeBps: number;
  readonly meaningfulChanges: number;
  /**
   * The latest observation on record, which is what "My watchlist" shows.
   *
   * Carried here so the two screens can be reconciled instead of quietly
   * disagreeing. They diverge whenever the market has moved since the last
   * threshold crossing, which with a generator running is almost always — the
   * feed reported RELIANCE at ₹2,900.00 while the watchlist reported ₹2,814.51
   * at the same instant, and nothing on either screen explained why.
   *
   * `undefined` when the instrument has never been observed.
   */
  readonly observedPrice: number | undefined;
  readonly observedAt: number | undefined;
}

export interface AttentionFeedResponse {
  readonly userId: string;
  /** The user's watermark at the time of this read. Unchanged by reading it. */
  readonly sinceSequence: number;
  /** The log head at the time of this read. What the client would acknowledge. */
  readonly throughSequence: number;
  /**
   * The whole unread window, never truncated.
   *
   * `events` below is capped; this is not, and the asymmetry is deliberate.
   * "9 instruments need your attention" and "30 meaningful changes" must stay
   * true regardless of how many events the response chose to carry — a count
   * that silently meant "of the page you were sent" would be the same class of
   * quiet dishonesty this product exists to avoid.
   */
  readonly summary: {
    readonly meaningfulChanges: number;
    readonly instruments: readonly FeedInstrumentSummary[];
  };
  /**
   * Ranked by significance, largest first. Not chronological.
   *
   * **Capped.** The unread window has no upper bound — the longer someone stays
   * away, which is the premise of this product, the more there is — so a
   * response carrying all of it grows without limit (measured: 4.4 MB against a
   * 20,000-event log, re-fetched on every poll). At most `eventLimit` events
   * are returned, the most significant first.
   *
   * When `events.length < summary.meaningfulChanges` the client is holding a
   * page, and must say so rather than implying it has everything.
   */
  readonly events: readonly FeedEvent[];
  /**
   * The cap in force, so a client can tell a truncated page from a short one.
   *
   * Note what this does **not** change: `throughSequence` is still the whole
   * window, so acknowledging still means "everything up to now", exactly as the
   * control says. Acknowledging only the page shown is not expressible — events
   * are ranked by magnitude, so the page is not a prefix of the log, and a
   * single watermark cannot describe a non-prefix. Anything that tried would
   * strand the unshown events permanently, because watermarks only move
   * forward.
   */
  readonly eventLimit: number;
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

/**
 * The replay timeline for one instrument.
 *
 * Deliberately carries no user: replay is a projection of shared history, and a
 * request that cannot name a user cannot advance one's read position (R5). That
 * is a structural guarantee, not a rule someone has to remember.
 */
export interface ReplayResponse {
  readonly instrumentId: string;
  /** Ordered by sequence. Every recorded event, regardless of who has read it. */
  readonly timeline: readonly FeedEvent[];
}

/**
 * What there is to replay.
 *
 * Derived from the shared log and, like `ReplayResponse`, carrying no user: it
 * answers "which instruments have a story" and never "which stories are mine".
 * An instrument with no recorded events is absent, because a replay of nothing
 * is not a thing to offer.
 */
export interface ReplayCatalogueResponse {
  readonly instruments: readonly {
    readonly instrumentId: string;
    readonly events: number;
    /** Largest single recorded move, so the picker can lead with the best story. */
    readonly largestMoveBps: number;
    /**
     * The market benchmark, which is a different kind of thing to replay.
     *
     * It is refused from watchlists and excluded from the feed, and then sat in
     * the replay picker as an ordinary peer with no explanation and no market
     * context of its own — the one screen where the design intent never reached
     * the interface. Flagged here so the picker can say what it is rather than
     * the client hardcoding a symbol the server already knows.
     */
    readonly isBenchmark: boolean;
  }[];
}

/**
 * One row of the watchlist: what the user follows, and the latest we know.
 *
 * `latestPrice` and `observedAt` are what we last *recorded*, never a live
 * price. Any label rendered from them must say so.
 */
export interface WatchlistRowView {
  readonly instrumentId: string;
  /** Absent when we follow an instrument we have never observed. */
  readonly latestPrice: number | undefined;
  readonly observedAt: number | undefined;
  readonly meaningfulChanges: number;
  /** Absent when nothing meaningful happened — distinct from a net move of 0. */
  readonly netChangeBps: number | undefined;
  readonly attention: 'quiet' | 'changed';
}

export interface WatchlistResponse {
  readonly userId: string;
  readonly rows: readonly WatchlistRowView[];
}
