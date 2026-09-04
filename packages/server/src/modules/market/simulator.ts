import type {
  Clock,
  InstrumentId,
  MarketState,
  MarketStatusResponse,
  SignificanceRule,
} from '@market-pulse/domain';
import { DEFAULT_RULE, initialState, observeTick, paise } from '@market-pulse/domain';
import type { EventStore } from './event-store.js';
import type { SnapshotStore } from './snapshot-store.js';
import { findInstrument } from './catalogue.js';

/**
 * A market that keeps moving after the seed has run.
 *
 * There is no market data feed in this project and this is not one. It is a
 * generator: it invents prices, and then hands every one of them to the *same*
 * `observeTick` the seed and the tests use. That is the point of putting it
 * here rather than writing events directly -- a simulated price gets no special
 * path into history. If it produces an event, it produced it by crossing the
 * published threshold, and the "Why is this significant?" panel in the UI
 * explains it with the same numbers as any other event.
 *
 * What it may do: append events, and overwrite snapshots. What it cannot do:
 * anything else. It holds no watermark store, so a running simulation can never
 * consume a user's unread events (I4), and the append-only triggers mean it
 * could not rewrite history even if it tried (I2).
 */

/**
 * Deterministic PRNG (mulberry32).
 *
 * `Math.random` would make a failing simulator test impossible to reproduce.
 * Seeded, the whole simulation is a pure function of (seed, tick count), so a
 * test can assert on prices that are invented but not arbitrary.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Converts a uniform half-width into a standard deviation: sqrt(3). */
const UNIFORM_TO_SD = Math.sqrt(3);

interface Tracked {
  state: MarketState;
  /**
   * The level the walk is pulled back toward: where this instrument's seeded
   * story left it, not where that story opened.
   *
   * Reverting to the opening price looked more natural and quietly destroyed
   * the demo. INFY's story is a genuine 20% fall from 1500 to 1200; a pull
   * back toward 1500 rallied it 25% over the first few minutes and turned the
   * one instrument that is supposed to have actually gone down into another
   * round trip. Each story keeps its shape by oscillating around its own
   * ending.
   */
  readonly restingPrice: number;
  readonly volatility: number;
  readonly reversion: number;
}

export interface Simulator {
  /** Begins generating observations. Calling it twice is harmless. */
  start(): void;
  stop(): void;
  /** Generates one observation per tracked instrument. Returns events appended. */
  step(): number;
  status(): MarketStatusResponse;
}

export interface SimulatorOptions {
  events: EventStore;
  snapshots: SnapshotStore;
  clock: Clock;
  intervalMs: number;
  /** Injected so a test can drive a reproducible sequence of prices. */
  random?: () => number;
  rule?: SignificanceRule;
}

/**
 * Rebuilds the engine state for one instrument from what is already durable.
 *
 * The anchor is the subtle part. It is not the latest price -- it is the price
 * the *current* move is being measured from, which after an emission is the
 * price that triggered it. Restarting the process with the anchor reset to the
 * latest price would silently re-arm the threshold from the wrong place, and
 * the first event after every restart would be measured against a level that
 * was never an anchor. So it comes from the last recorded event's `toPrice`,
 * and only falls back to the snapshot for an instrument that has no history.
 */
function resume(
  instrument: InstrumentId,
  latestPrice: number,
  observedAt: number,
  events: EventStore,
): MarketState {
  const history = events.readAfter(0, instrument);
  const last = history[history.length - 1];
  const seed = initialState({
    instrumentId: instrument,
    price: paise(latestPrice),
    at: observedAt,
  });
  return last === undefined ? seed : { ...seed, anchorPrice: last.event.toPrice };
}

export function createSimulator({
  events,
  snapshots,
  clock,
  intervalMs,
  random = seededRandom(0x5eed),
  rule = DEFAULT_RULE,
}: SimulatorOptions): Simulator {
  /**
   * Only instruments we have already observed are simulated.
   *
   * An instrument someone adds to a watchlist that this fictional market does
   * not trade gets no invented price. The row says "Never observed", which is
   * true, and is a better answer than a plausible number with nothing behind
   * it.
   */
  const tracked = new Map<InstrumentId, Tracked>();
  for (const snapshot of snapshots.list()) {
    const profile = findInstrument(snapshot.instrumentId);
    if (profile === undefined) continue;
    tracked.set(snapshot.instrumentId, {
      state: resume(snapshot.instrumentId, snapshot.latestPrice, snapshot.observedAt, events),
      restingPrice: snapshot.latestPrice,
      volatility: profile.volatility,
      reversion: profile.reversion,
    });
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let lastTickAt: number | undefined;

  /**
   * One step of a mean-reverting random walk, in whole paise.
   *
   * Two terms. The shock is where the movement comes from; the pull is what
   * stops a walk of a few hundred steps from wandering somewhere absurd, and
   * has the side effect of producing exactly the shape this product is about --
   * a price that leaves and comes back while events pile up behind it.
   */
  function nextPrice(entry: Tracked): number {
    const last = entry.state.lastPrice;
    const pull = ((entry.restingPrice - last) / entry.restingPrice) * entry.reversion;
    // UNIFORM_TO_SD makes `volatility` mean what it says. A uniform draw over
    // [-w, w] has a standard deviation of w/sqrt(3), so using the half-width
    // directly made every instrument 42% calmer than its profile claimed --
    // calm enough that the seeded market produced almost nothing on its own.
    const shock = (random() * 2 - 1) * entry.volatility * UNIFORM_TO_SD;
    // Never below one paisa: `paise()` rejects negatives, and a price of zero
    // would make every later percentage undefined.
    return Math.max(1, Math.round(last * (1 + pull + shock)));
  }

  function step(): number {
    const at = clock.now();
    let appended = 0;

    for (const [instrument, entry] of tracked) {
      /*
       * Skip rather than throw when our clock is behind the last observation.
       *
       * `observeTick` rejects an out-of-order tick, correctly -- accepting one
       * would corrupt history in a way no later read could detect. But this
       * runs on an interval, and an exception here would take the whole
       * generator down with it. It can happen for real: a seed written with a
       * future timestamp, or a clock that steps backwards. Recording nothing
       * for one instrument on one step costs the demo nothing; inventing a
       * timestamp to get past the check would be the dishonest fix.
       */
      if (at < entry.state.lastAt) continue;

      const price = paise(nextPrice(entry));
      const observation = observeTick(entry.state, { instrumentId: instrument, price, at }, rule);
      entry.state = observation.state;

      // Append first, then snapshot. If the process dies between the two, the
      // event log -- the thing that cannot be rebuilt -- is the part that
      // survived. A snapshot is only ever the latest observation, and the next
      // step rewrites it anyway.
      appended += events.append(observation.events).length;
      snapshots.record(instrument, price, at);
    }

    lastTickAt = at;
    return appended;
  }

  return {
    start() {
      if (timer !== undefined || tracked.size === 0) return;
      timer = setInterval(step, intervalMs);
      // Do not hold the process open. A simulation is not a reason for the
      // server to refuse to exit.
      timer.unref?.();
    },
    stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    },
    step,
    status() {
      return {
        source: 'simulated',
        running: timer !== undefined,
        intervalMs: timer === undefined ? 0 : intervalMs,
        lastTickAt,
        instruments: tracked.size,
        sequence: events.head(),
      };
    },
  };
}

/** What the API reports when nothing is generating prices. */
export function staticStatus(events: EventStore): MarketStatusResponse {
  return {
    source: 'static',
    running: false,
    intervalMs: 0,
    lastTickAt: undefined,
    instruments: 0,
    sequence: events.head(),
  };
}
