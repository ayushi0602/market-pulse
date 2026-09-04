/**
 * Wire contract for the market data source.
 *
 * This exists so the client never has to *assume* where prices come from. The
 * UI makes a claim about freshness on every screen ("as recorded 1:40 pm"), and
 * a claim the client invents is a claim that can quietly become false. The
 * server says what it is running; the client repeats it and nothing more.
 *
 * `source` has no 'live' member on purpose. There is no market data feed in
 * this system, and adding the word to a union is how an overclaim starts.
 */
export type MarketSource = 'simulated' | 'static';

export interface MarketStatusResponse {
  /**
   * 'simulated' when a generator is producing observations, 'static' when the
   * only prices are the ones the seed wrote.
   */
  readonly source: MarketSource;
  readonly running: boolean;
  /** Milliseconds between generated observations. 0 when nothing is running. */
  readonly intervalMs: number;
  /** When the generator last produced an observation. Absent before the first. */
  readonly lastTickAt: number | undefined;
  /** How many instruments the generator is producing observations for. */
  readonly instruments: number;
  /**
   * Current head of the shared event log.
   *
   * Cheap for a client to poll: history grew if and only if this number grew,
   * so a page can tell there is something new without re-reading a whole feed.
   */
  readonly sequence: number;
}
