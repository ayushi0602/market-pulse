import { useCallback, useEffect, useState } from 'react';
import type { WatchlistResponse, WatchlistRowView } from '@market-pulse/domain';
import { addToWatchlist, fetchWatchlist, removeFromWatchlist } from './api.js';
import { formatPercent, formatPrice, formatTime, pluralise } from './format.js';

/**
 * What the user follows — which is not the same list as what deserves attention.
 *
 * An instrument that never crosses the significance threshold appears here and
 * nowhere in the feed. Both lists are right; they answer different questions.
 */
function Row({
  row,
  onRemove,
}: {
  row: WatchlistRowView;
  onRemove: (instrumentId: string) => void;
}) {
  const changed = row.attention === 'changed';

  return (
    <div className="row" data-testid={`watchlist-${row.instrumentId}`}>
      <div>
        <div className="symbol">{row.instrumentId}</div>
        {changed ? (
          <div style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.875rem' }}>
            ● {pluralise(row.meaningfulChanges, 'meaningful change')}
            {row.netChangeBps === 0
              ? ' — but the price came back'
              : row.netChangeBps !== undefined && ` — net ${formatPercent(row.netChangeBps)}`}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: '0.875rem' }}>
            ✓ No meaningful changes
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right' }}>
        <div className="big-number">
          {row.latestPrice === undefined ? '—' : formatPrice(row.latestPrice)}
        </div>
        <div className="muted" style={{ fontSize: '0.8125rem' }}>
          {/* Never "live": this is the last observation we recorded, and the
              label must not claim more than the data model knows. */}
          {row.observedAt === undefined
            ? 'Never observed'
            : `As recorded ${formatTime(row.observedAt)}`}
        </div>
        <button
          type="button"
          className="link"
          onClick={() => onRemove(row.instrumentId)}
          aria-label={`Remove ${row.instrumentId}`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function Watchlist({ userId }: { userId: string }) {
  const [data, setData] = useState<WatchlistResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');

  const apply = useCallback((response: Promise<WatchlistResponse>) => {
    response
      .then((next) => {
        setData(next);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Unknown error');
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchWatchlist(userId, controller.signal)
      .then(setData)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Unknown error');
      });
    return () => controller.abort();
  }, [userId]);

  if (error !== undefined) {
    return <p className="muted">Could not load your watchlist — {error}</p>;
  }
  if (data === undefined) {
    return <p className="muted">Loading your watchlist…</p>;
  }

  const needingAttention = data.rows.filter((r) => r.attention === 'changed').length;

  return (
    <div>
      <p className="subtitle">
        {data.rows.length === 0
          ? 'Nothing followed yet.'
          : `${pluralise(data.rows.length, 'instrument')} followed. ${
              needingAttention === 0
                ? 'None need your attention.'
                : `${needingAttention} need your attention.`
            }`}
      </p>

      {data.rows.length > 0 && (
        <div className="card">
          {data.rows.map((row) => (
            <Row
              key={row.instrumentId}
              row={row}
              onRemove={(instrumentId) => apply(removeFromWatchlist(userId, instrumentId))}
            />
          ))}
        </div>
      )}

      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          const symbol = draft.trim().toUpperCase();
          if (symbol.length === 0) return;
          setDraft('');
          apply(addToWatchlist(userId, symbol));
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a symbol"
          aria-label="Instrument symbol"
        />
        <button type="submit" className="primary" disabled={draft.trim().length === 0}>
          Add
        </button>
      </form>

      <p className="muted" style={{ marginTop: '1.5rem' }}>
        Prices are the latest observation recorded by this system, not a live quote. An instrument
        with no meaningful changes still belongs here — that is the difference between a watchlist
        and an attention feed.
      </p>
    </div>
  );
}
