import { useCallback, useState } from 'react';
import type { MarketStatusResponse } from '@market-pulse/domain';
import { fetchMarketStatus, setMarketRunning } from './api.js';
import { usePoll } from './usePoll.js';
import { formatTime, pluralise } from './format.js';

/**
 * Says where the prices come from, in the server's own words.
 *
 * Every other screen makes a claim about freshness. This is the one place that
 * says what is actually behind those claims, and it says "simulated" because
 * that is what it is -- there is no market data feed in this system. The word
 * "live" appears nowhere: a generated price arriving three seconds ago is
 * recent, and it is still not a quote.
 *
 * The pause control is what makes a moving market safe to demo. Stop it to talk
 * over a screen, start it again to watch events arrive. It stops a timer and
 * nothing else: everything already recorded stays exactly as it is.
 */
const STATUS_POLL_MS = 2000;

function seconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

export function MarketStatus() {
  const load = useCallback((signal: AbortSignal) => fetchMarketStatus(signal), []);
  const { data, error, refresh } = usePoll<MarketStatusResponse>(load, STATUS_POLL_MS);

  const [busy, setBusy] = useState(false);
  /**
   * The log head when this page opened.
   *
   * Kept so the strip can say how much arrived while the reviewer was here,
   * which is the difference between a number that updates and a number they
   * watched grow. Set once, from the first reading.
   */
  const [openedAt, setOpenedAt] = useState<{ sequence: number } | undefined>(undefined);
  if (data !== undefined && openedAt === undefined) {
    // Captured during render from the first response. State rather than a ref,
    // because the rendered output depends on it and render may not read a ref.
    //
    // Wrapped in an object deliberately. A bare `number | undefined` would make
    // this loop forever against a response whose `sequence` was missing: the
    // guard would still see `undefined` after the write and set it again. The
    // wrapper makes termination structural instead of dependent on the value.
    setOpenedAt({ sequence: data.sequence });
  }

  if (error !== undefined && data === undefined) {
    return (
      <div className="status status-down">
        <span className="dot" aria-hidden="true" />
        <span>API unreachable — {error}</span>
      </div>
    );
  }
  if (data === undefined) {
    return <div className="status status-idle">Checking the market…</div>;
  }

  const isStatic = data.source === 'static';
  const arrived = openedAt === undefined ? 0 : data.sequence - openedAt.sequence;

  const toggle = () => {
    setBusy(true);
    setMarketRunning(!data.running)
      .then(() => refresh())
      .catch(() => refresh())
      .finally(() => setBusy(false));
  };

  return (
    <div className={`status ${data.running ? 'status-running' : 'status-paused'}`}>
      <span className="dot" aria-hidden="true" />

      <span className="status-label">
        {isStatic
          ? 'Static data — nothing is generating prices'
          : data.running
            ? `Simulated market — new observations every ${seconds(data.intervalMs)}`
            : 'Simulated market — paused'}
      </span>

      <span className="status-facts">
        <span title="Position of the newest event in the shared log">
          {pluralise(data.sequence, 'event')} recorded
        </span>
        {arrived > 0 && <span className="status-new">+{arrived} since you opened this page</span>}
        {data.lastTickAt !== undefined && (
          <span className="observed">last at {formatTime(data.lastTickAt)}</span>
        )}
        {/* Reached only with data already on screen -- the no-data-plus-error
            case returns above -- so this is the "it was working a moment ago"
            state, not the "it never worked" one. */}
        {error !== undefined && <span className="status-stale">reconnecting…</span>}
      </span>

      {!isStatic && (
        <button type="button" className="link quiet" onClick={toggle} disabled={busy}>
          {data.running ? '⏸ Pause market' : '▶ Resume market'}
        </button>
      )}
    </div>
  );
}
