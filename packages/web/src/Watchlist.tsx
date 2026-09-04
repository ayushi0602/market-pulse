import { useCallback, useState } from 'react';
import type { WatchlistResponse, WatchlistRowView } from '@market-pulse/domain';
import { addToWatchlist, fetchWatchlist, removeFromWatchlist } from './api.js';
import { usePoll } from './usePoll.js';
import { formatPercent, formatPrice, formatTime, pluralise } from './format.js';

/** How often the watchlist re-reads. Slower than the market moves, on purpose. */
const WATCHLIST_POLL_MS = 4000;

/**
 * What the user follows — which is not the same list as what deserves attention.
 *
 * An instrument that never crosses the significance threshold appears here and
 * nowhere in the feed. Both lists are right; they answer different questions.
 */
function Row({
  row,
  onRemove,
  onViewChanges,
}: {
  row: WatchlistRowView;
  onRemove: (instrumentId: string) => void;
  onViewChanges: () => void;
}) {
  const changed = row.attention === 'changed';

  /**
   * Flash the price when it changes between polls.
   *
   * With a market running, a table of twelve numbers quietly rewriting itself
   * is easy to miss entirely. The flash is the only thing on the page that
   * exists purely to say "this just moved" -- and it is animation on a value
   * that genuinely changed, not decoration.
   */
  const [seen, setSeen] = useState<{ price: number | undefined; move: 'up' | 'down' | 'none' }>({
    price: row.latestPrice,
    move: 'none',
  });
  if (seen.price !== row.latestPrice) {
    // Adjusted during render rather than in an effect: React re-runs the render
    // before committing, so the flash class is right the first time the new
    // price is painted. An effect would paint the number once without it and
    // then again with it. A ref would be simpler and is not allowed to be read
    // during render -- correctly, since the class depends on it.
    setSeen({
      price: row.latestPrice,
      move: (row.latestPrice ?? 0) > (seen.price ?? 0) ? 'up' : 'down',
    });
  }
  const flash = seen.move === 'none' ? '' : ` flash-${seen.move}`;

  return (
    <div className="row" data-testid={`watchlist-${row.instrumentId}`}>
      <div>
        <div className="symbol">{row.instrumentId}</div>
        {changed ? (
          <>
            <div className="attention-note">
              ● {pluralise(row.meaningfulChanges, 'meaningful change')}
              {row.netChangeBps === 0
                ? ' — but the price came back'
                : row.netChangeBps !== undefined && ` — net ${formatPercent(row.netChangeBps)}`}
            </div>
            <button type="button" className="link" onClick={onViewChanges}>
              View what happened →
            </button>
          </>
        ) : (
          <div className="muted quiet-note">✓ No meaningful changes</div>
        )}
      </div>

      <div className="row-end">
        <div
          className={`big-number${flash}`}
          // Re-keyed on the price so the flash animation restarts on every
          // change rather than running once and never again.
          key={row.latestPrice ?? 'none'}
        >
          {row.latestPrice === undefined ? '—' : formatPrice(row.latestPrice)}
        </div>
        <div className="muted observed">
          {/* Never "live": this is the last observation we recorded, and the
              label must not claim more than the data model knows. */}
          {row.observedAt === undefined
            ? 'Never observed'
            : `As recorded ${formatTime(row.observedAt)}`}
        </div>
        <button
          type="button"
          className="link quiet"
          onClick={() => onRemove(row.instrumentId)}
          aria-label={`Remove ${row.instrumentId}`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function Watchlist({
  userId,
  onViewChanges,
}: {
  userId: string;
  /** Takes the reviewer straight to the argument, one click from the entry point. */
  onViewChanges: () => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => fetchWatchlist(userId, signal),
    // A new user id is a new poll, which is the intent.
    [userId],
  );
  const { data, error, override } = usePoll<WatchlistResponse>(load, WATCHLIST_POLL_MS);
  const [draft, setDraft] = useState('');
  const [writeError, setWriteError] = useState<string | undefined>(undefined);

  const apply = (response: Promise<WatchlistResponse>) => {
    response
      .then((next) => {
        setWriteError(undefined);
        // The server returns the updated list, so use it rather than asking
        // again: re-reading would leave the removed row on screen until the
        // round trip finished.
        override(next);
      })
      .catch((cause: unknown) => {
        setWriteError(cause instanceof Error ? cause.message : 'Unknown error');
      });
  };

  if (data === undefined) {
    return error === undefined ? (
      <p className="muted">Loading your watchlist…</p>
    ) : (
      <p className="muted">Could not load your watchlist — {error}</p>
    );
  }

  /**
   * Two groups, one list.
   *
   * Membership and order still come from the store (W1) — this splits the rows
   * for the eye and changes nothing about what they are. With twelve
   * instruments an undifferentiated column makes the reader do the sorting, and
   * the whole product is about not making them do that.
   */
  const needsAttention = data.rows.filter((row) => row.attention === 'changed');
  const quiet = data.rows.filter((row) => row.attention === 'quiet');

  const rowProps = {
    onRemove: (instrumentId: string) => apply(removeFromWatchlist(userId, instrumentId)),
    onViewChanges,
  };

  return (
    <div>
      <p className="subtitle">
        {data.rows.length === 0
          ? 'Nothing followed yet.'
          : `${pluralise(data.rows.length, 'instrument')} followed. ${
              needsAttention.length === 0
                ? 'None need your attention.'
                : `${needsAttention.length} need your attention.`
            }`}
      </p>

      {error !== undefined && (
        <p className="muted">Showing the last good reading — reconnecting after {error}.</p>
      )}

      {needsAttention.length > 0 && (
        <>
          <h2 className="group-heading">
            Needs your attention <span className="count">{needsAttention.length}</span>
          </h2>
          <div className="card">
            {needsAttention.map((row) => (
              <Row key={row.instrumentId} row={row} {...rowProps} />
            ))}
          </div>
        </>
      )}

      {quiet.length > 0 && (
        <>
          <h2 className="group-heading">
            Quiet <span className="count">{quiet.length}</span>
          </h2>
          <p className="muted group-note">
            Nothing here crossed the threshold. They are still on your list, because a watchlist is
            what you care about — not only what changed.
          </p>
          <div className="card">
            {quiet.map((row) => (
              <Row key={row.instrumentId} row={row} {...rowProps} />
            ))}
          </div>
        </>
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

      {writeError !== undefined && <p className="muted">That did not save — {writeError}.</p>}

      <p className="muted footnote">
        Prices are the latest observation recorded by this system, not a live quote. A symbol this
        market does not trade can still be followed — it will read <em>Never observed</em>, which is
        the honest answer rather than an invented number.
      </p>
    </div>
  );
}
