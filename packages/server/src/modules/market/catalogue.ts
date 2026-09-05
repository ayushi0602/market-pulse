/**
 * The fictional market this build trades in.
 *
 * One place describes it, because two places would drift: the seed writes the
 * opening story from `openingPath`, and the simulator continues each
 * instrument from where that story left off using `volatility` and
 * `reversion`. If those lived in separate files, a symbol could exist in one
 * and not the other.
 *
 * This is demo infrastructure, not product rules -- which is why it sits in
 * `server` and not in `domain`. The domain decides what is *significant*; this
 * file only decides what the prices are. Nothing here is real market data and
 * nothing in the system claims it is.
 */
export interface DemoInstrument {
  readonly symbol: string;
  /** Prices in rupees, in order, half an hour apart. The story before you arrived. */
  readonly openingPath: readonly number[];
  /**
   * Standard deviation of one simulated step, as a fraction of the last price.
   * 0.006 is a 0.6% typical move.
   */
  readonly volatility: number;
  /**
   * How strongly each step is pulled back toward the opening price, 0 to 1.
   *
   * Without this a random walk wanders off and never comes back, and after an
   * hour the demo is showing a stock at four times its opening price. With it,
   * prices oscillate around where they started -- which is also the behaviour
   * the product exists to talk about: a price that returns to where it was
   * while things happened in between.
   */
  readonly reversion: number;
  /** Why this instrument is in the catalogue. Printed by the seed. */
  readonly note: string;
}

/**
 * Which instrument every other event is classified against.
 *
 * A single named constant rather than a field on the entry, because exactly
 * one module (`classifySignal`'s caller) needs to know which symbol is
 * special, and a constant keeps that decision in one place instead of a
 * `role` field every reader of `CATALOGUE` would otherwise have to consider.
 *
 * The benchmark is tracked and simulated exactly like any other instrument --
 * same significance rule, same simulator loop, no special-cased engine path
 * (I3 stays intact). What is special is what the *server* does with it: the
 * seed does not add it to anyone's watchlist (it is market context, not
 * something to follow), and the attention feed does not count its own events
 * as things to read (a benchmark moving is not, by itself, something that
 * happened to an instrument the user cares about).
 */
export const BENCHMARK_SYMBOL = 'NIFTY';

/*
 * Three profiles, tuned by measurement rather than by feel.
 *
 * `volatility` is the standard deviation of one step and `reversion` is the
 * pull back toward the opening price, so the long-run spread around the open is
 * roughly volatility / sqrt(1 - (1 - reversion)^2). CALM lands about 0.2% wide,
 * which puts the 5% threshold twenty-odd standard deviations away -- the quiet
 * instruments stay quiet through a live demo, and a test runs two thousand
 * steps to prove it. The other two are set so the whole market produces
 * something worth noticing every minute or so without burying the feed.
 */
const CALM = { volatility: 0.0015, reversion: 0.4 } as const;
const NORMAL = { volatility: 0.0045, reversion: 0.04 } as const;
const LIVELY = { volatility: 0.007, reversion: 0.06 } as const;

export const CATALOGUE: readonly DemoInstrument[] = Object.freeze([
  {
    symbol: BENCHMARK_SYMBOL,
    // One clear decline, one partial recovery -- enough for other events to be
    // compared against without the benchmark's own story dominating the feed.
    // Chosen (and verified by simulation) so RELIANCE's decline lands
    // market-wide, INFY's -20% lands as a clear outlier, and RELIANCE's own
    // recovery -- which outpaces this rebound -- lands as an outlier too.
    openingPath: [18000, 17800, 16740, 17200, 17600],
    ...NORMAL,
    note: 'the benchmark — other events are read against it, never itself read',
  },
  {
    symbol: 'RELIANCE',
    // The golden scenario. Falls 9%, recovers 9.89%, ends exactly where it began.
    openingPath: [2900, 2840, 2639, 2750, 2900],
    ...NORMAL,
    note: 'round trip — ends exactly where it started',
  },
  {
    symbol: 'INFY',
    openingPath: [1500, 1470, 1200],
    ...NORMAL,
    note: 'a genuine 20% fall — a snapshot would catch this one too',
  },
  {
    symbol: 'TCS',
    openingPath: [3800, 3810, 3795, 3805],
    ...CALM,
    note: 'quiet — never crosses the threshold, and still belongs on the list',
  },
  {
    symbol: 'ADANIENT',
    // Five crossings. The busiest story in the catalogue.
    openingPath: [3200, 3000, 3250, 2950, 3180, 2900],
    ...LIVELY,
    note: 'volatile — five threshold crossings before you arrived',
  },
  {
    symbol: 'TATAMOTORS',
    openingPath: [780, 820, 890, 960],
    ...LIVELY,
    note: 'a genuine rally — three advances, and the snapshot agrees',
  },
  {
    symbol: 'HDFCBANK',
    // The round trip in the other direction: up first, then back.
    openingPath: [1650, 1700, 1782, 1700, 1650],
    ...NORMAL,
    note: 'round trip upward — rose 8%, gave it all back',
  },
  {
    symbol: 'ZOMATO',
    openingPath: [260, 234, 250, 262],
    ...LIVELY,
    note: 'fell hard, mostly recovered — net barely moved',
  },
  {
    symbol: 'SBIN',
    // A slow slide: -9.4% overall, reported as one -5.65% crossing. This is the
    // staged-move limitation, deliberately visible rather than hidden.
    openingPath: [620, 608, 596, 585, 573, 562],
    ...NORMAL,
    note: 'a slow slide — shows the staged-move limitation honestly',
  },
  {
    symbol: 'BAJFINANCE',
    openingPath: [7200, 6800, 6650],
    ...NORMAL,
    note: 'one clear decline',
  },
  {
    symbol: 'HINDUNILVR',
    openingPath: [2450, 2500, 2620],
    ...NORMAL,
    note: 'one clear advance',
  },
  {
    symbol: 'WIPRO',
    openingPath: [450, 452, 449, 451],
    ...CALM,
    note: 'quiet',
  },
  {
    symbol: 'ITC',
    openingPath: [445, 447, 444, 446],
    ...CALM,
    note: 'quiet',
  },
]);

export function findInstrument(symbol: string): DemoInstrument | undefined {
  return CATALOGUE.find((entry) => entry.symbol === symbol);
}
