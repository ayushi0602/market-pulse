import type { MeaningfulMarketEvent } from './event.js';
import type { InstrumentId } from './instrument.js';
import type { MarketTick } from './tick.js';
import type { BasisPoints, PriceMinor } from './money.js';
import { changeInBasisPoints } from './money.js';
import type { Timestamp } from '../clock.js';

/**
 * What counts as meaningful.
 *
 * One number, deliberately. The rule is a value the caller supplies rather than
 * a constant the engine hides, because "significant" is a product decision that
 * will change -- and because a rule passed in is a rule a test can vary.
 */
export interface SignificanceRule {
  /** Minimum move from the anchor, in basis points, to be worth reporting. */
  readonly thresholdBps: BasisPoints;
}

/** 5%. A placeholder chosen to be legible in tests, not calibrated against real markets. */
export const DEFAULT_RULE: SignificanceRule = Object.freeze({ thresholdBps: 500 });

/**
 * What the engine carries between ticks.
 *
 * `anchorPrice` is the reference the current move is measured from -- not the
 * previous tick's price. Measuring against the previous tick would make a slow
 * slide invisible: twenty ticks of -0.5% each is a 10% fall that never once
 * moves 5% in a single step. Measuring from an anchor catches it.
 */
export interface MarketState {
  readonly instrumentId: InstrumentId;
  readonly anchorPrice: PriceMinor;
  readonly lastPrice: PriceMinor;
  readonly lastAt: Timestamp;
}

export interface Observation {
  readonly state: MarketState;
  /** Events produced by this tick. At most one under the current rule. */
  readonly events: readonly MeaningfulMarketEvent[];
}

/** Seeds state from the first tick seen. That tick cannot itself be a transition. */
export function initialState(tick: MarketTick): MarketState {
  return Object.freeze({
    instrumentId: tick.instrumentId,
    anchorPrice: tick.price,
    lastPrice: tick.price,
    lastAt: tick.at,
  });
}

/**
 * Folds one tick into the state, emitting an event if the move from the anchor
 * has become significant.
 *
 * Pure: no clock, no randomness, no I/O, no mutation of the state passed in
 * (I3). Given the same state and tick it returns the same result forever, which
 * is what makes replay possible and the whole engine testable with plain values.
 *
 * When an event fires the anchor moves to the price that triggered it, so the
 * next event must earn its own threshold rather than re-reporting the same move.
 */
export function observeTick(
  state: MarketState,
  tick: MarketTick,
  rule: SignificanceRule = DEFAULT_RULE,
): Observation {
  if (tick.instrumentId !== state.instrumentId) {
    throw new Error(
      `Tick for ${tick.instrumentId} cannot be applied to state for ${state.instrumentId}`,
    );
  }
  // Out-of-order ticks are rejected rather than reordered or dropped. History is
  // the source of truth here, so silently accepting a tick from the past would
  // corrupt it in a way no later read could detect.
  if (tick.at < state.lastAt) {
    throw new Error(`Out-of-order tick: ${tick.at} precedes last observed ${state.lastAt}`);
  }

  const changeBps = changeInBasisPoints(state.anchorPrice, tick.price);
  const isSignificant = Math.abs(changeBps) >= rule.thresholdBps;

  if (!isSignificant) {
    return Object.freeze({
      state: Object.freeze({ ...state, lastPrice: tick.price, lastAt: tick.at }),
      events: Object.freeze([]),
    });
  }

  const event: MeaningfulMarketEvent = Object.freeze({
    instrumentId: state.instrumentId,
    direction: changeBps < 0 ? ('decline' as const) : ('advance' as const),
    fromPrice: state.anchorPrice,
    toPrice: tick.price,
    magnitudeBps: Math.abs(changeBps),
    occurredAt: tick.at,
  });

  return Object.freeze({
    state: Object.freeze({
      instrumentId: state.instrumentId,
      anchorPrice: tick.price,
      lastPrice: tick.price,
      lastAt: tick.at,
    }),
    events: Object.freeze([event]),
  });
}

/**
 * Folds a whole tick stream. The first tick seeds the state; the rest are
 * observed in order.
 */
export function observeTicks(
  ticks: readonly MarketTick[],
  rule: SignificanceRule = DEFAULT_RULE,
): { readonly state: MarketState | undefined; readonly events: readonly MeaningfulMarketEvent[] } {
  const [first, ...rest] = ticks;
  if (first === undefined) {
    return { state: undefined, events: [] };
  }

  let state = initialState(first);
  const events: MeaningfulMarketEvent[] = [];
  for (const tick of rest) {
    const observation = observeTick(state, tick, rule);
    state = observation.state;
    events.push(...observation.events);
  }

  return { state, events: Object.freeze(events) };
}
