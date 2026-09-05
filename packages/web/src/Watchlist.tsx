import { useCallback, useState } from 'react';
import type {
  InstrumentCatalogueResponse,
  WatchlistResponse,
  WatchlistRowView,
} from '@market-pulse/domain';
import { addToWatchlist, fetchInstruments, fetchWatchlist, removeFromWatchlist } from './api.js';
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
              {/*
                "but the price came back" was printed beside the *live* price,
                which is not where it came back to: RELIANCE read "the price
                came back" next to ₹2,814.51 while the events it describes
                ended at ₹2,900. The net is a fact about the changes you
                missed; the number on the right is the latest observation. Both
                cases now say "across them", which scopes the claim to the
                events and makes the two readings distinguishable.
              */}
              {/*
                "overall", not "across them": measured at 390px, the longer
                phrase wrapped every row to two lines with a single orphaned
                word, which is the kind of defect this repo's history says is
                only ever found by looking. "overall" scopes the net to the
                changes just as clearly and fits on one line at every count.
              */}
              {row.netChangeBps !== undefined &&
                ` — net ${formatPercent(row.netChangeBps)} overall`}
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

  // The catalogue does not change while the page is open, so this is a load,
  // not a poll. `usePoll` with an interval of 0 is exactly that.
  const loadInstruments = useCallback((signal: AbortSignal) => fetchInstruments(signal), []);
  const instruments = usePoll<InstrumentCatalogueResponse>(loadInstruments, 0);

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
      {/*
        The one line worth announcing on a screen that rewrites itself every
        four seconds. Prices changing is ambient; "9 need your attention"
        becoming 10 is the event — and for a sighted reader the price flash
        carries it, while for a screen-reader user nothing did.

        Not on the rows themselves: twelve numbers re-reading aloud on every
        poll would make the page unusable.
      */}
      <p className="subtitle" aria-live="polite">
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
          list="tradeable-instruments"
          autoComplete="off"
        />
        {/*
          The input was blind free text against a fictional market nobody can
          guess. Following an untraded symbol is still allowed -- see the
          footnote -- but it should be a choice, not an undetectable typo.
          The benchmark is deliberately absent: the server refuses it, so
          offering it would invite an error rather than prevent one.
        */}
        <datalist id="tradeable-instruments">
          {(instruments.data?.instruments ?? [])
            .filter((entry) => !entry.isBenchmark)
            .map((entry) => (
              <option key={entry.instrumentId} value={entry.instrumentId} />
            ))}
        </datalist>
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
