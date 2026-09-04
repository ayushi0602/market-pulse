import { useCallback, useEffect, useState } from 'react';
import type { AttentionFeedResponse } from '@market-pulse/domain';
import { acknowledge, fetchFeed } from './api.js';
import { AttentionFeed, TraditionalWatchlist } from './AttentionFeed.jsx';
import { ReplayView } from './Replay.jsx';
import { pluralise } from './format.js';

type View = 'pulse' | 'traditional';
type Tab = 'attention' | 'replay';

type State =
  | { status: 'loading' }
  | { status: 'ready'; feed: AttentionFeedResponse }
  | { status: 'error'; message: string };

export function App() {
  const [user, setUser] = useState('demo');
  const [view, setView] = useState<View>('pulse');
  const [tab, setTab] = useState<Tab>('attention');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [acknowledging, setAcknowledging] = useState(false);

  /**
   * Fetches and stores the feed. Deliberately does not set the loading state
   * itself: doing that synchronously inside an effect causes a cascading render,
   * and the previous feed staying on screen while the next one loads is better
   * behaviour anyway. Callers that want a spinner set it themselves, from an
   * event handler.
   */
  const load = useCallback((userId: string, signal?: AbortSignal) => {
    fetchFeed(userId, signal)
      .then((feed) => setState({ status: 'ready', feed }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(user, controller.signal);
    return () => controller.abort();
  }, [user, load]);

  /**
   * Acknowledging is an explicit action, never a side effect of rendering.
   *
   * The server refuses to advance the watermark on a read, so this button is
   * the only thing that can consume the feed. That is the point: a user who
   * reloads, or whose connection drops mid-render, still has everything waiting
   * for them.
   */
  const onAcknowledge = () => {
    if (state.status !== 'ready') return;
    setAcknowledging(true);
    acknowledge(user, state.feed.throughSequence)
      .then(() => {
        load(user);
      })
      .catch((error: unknown) => {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      })
      .finally(() => setAcknowledging(false));
  };

  return (
    <main className="shell">
      <p className="eyebrow">Market Pulse</p>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'attention'}
          onClick={() => setTab('attention')}
        >
          While you were away
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'replay'}
          onClick={() => setTab('replay')}
        >
          Replay
        </button>
      </div>

      {tab === 'replay' && (
        <>
          <h1>What actually happened</h1>
          <p className="subtitle">
            The same history, stepped through in the order it was recorded. Watching it changes
            nothing — not the events, and not your read position.
          </p>
          <ReplayView instrumentId="RELIANCE" />
        </>
      )}

      {tab === 'attention' && state.status === 'loading' && (
        <p className="muted">Checking what you missed…</p>
      )}

      {tab === 'attention' && state.status === 'error' && (
        <>
          <h1>Something went wrong</h1>
          <p className="subtitle">{state.message}</p>
          <p className="muted">
            Is the API running? Try <code>npm run dev</code>, then <code>npm run db:seed</code>.
          </p>
        </>
      )}

      {tab === 'attention' && state.status === 'ready' && (
        <>
          <h1>
            {state.feed.summary.meaningfulChanges === 0
              ? 'You are all caught up'
              : 'While you were away'}
          </h1>
          <p className="subtitle">
            {state.feed.summary.meaningfulChanges === 0
              ? 'Nothing has crossed the significance threshold since you last checked.'
              : `${pluralise(state.feed.summary.meaningfulChanges, 'meaningful change')} across ${pluralise(
                  state.feed.summary.instruments.length,
                  'instrument',
                )}.`}
          </p>

          {state.feed.events.length > 0 && (
            <>
              <div className="toggle" role="group" aria-label="Comparison">
                <button
                  type="button"
                  aria-pressed={view === 'traditional'}
                  onClick={() => setView('traditional')}
                >
                  Traditional watchlist
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'pulse'}
                  onClick={() => setView('pulse')}
                >
                  Market Pulse
                </button>
              </div>

              {view === 'pulse' ? (
                <AttentionFeed feed={state.feed} />
              ) : (
                <TraditionalWatchlist feed={state.feed} />
              )}
            </>
          )}

          {state.feed.events.length === 0 && (
            <div className="card empty">
              <div className="tick" aria-hidden="true">
                ✓
              </div>
              <p>
                Read position {state.feed.sinceSequence} of {state.feed.throughSequence}.
              </p>
              <p className="muted">
                Try another user below — the log is shared, but each person&rsquo;s position in it
                is their own.
              </p>
            </div>
          )}

          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={onAcknowledge}
              disabled={acknowledging || state.feed.events.length === 0}
            >
              {acknowledging ? 'Marking…' : 'Mark all as read'}
            </button>
            <label className="muted">
              Viewing as{' '}
              <input
                type="text"
                value={user}
                onChange={(e) => {
                  setState({ status: 'loading' });
                  setUser(e.target.value.trim() || 'demo');
                }}
                aria-label="User id"
              />
            </label>
          </div>
        </>
      )}
    </main>
  );
}
