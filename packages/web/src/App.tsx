import { useCallback, useState } from 'react';
import type { AttentionFeedResponse } from '@market-pulse/domain';
import { acknowledge, fetchFeed } from './api.js';
import { AttentionFeed, TraditionalWatchlist } from './AttentionFeed.jsx';
import { Header, panelId, tabId } from './Header.jsx';
import { MarketStatus } from './MarketStatus.jsx';
import { ReplayView } from './Replay.jsx';
import { Watchlist } from './Watchlist.jsx';
import { usePoll } from './usePoll.js';
import { pluralise } from './format.js';

type View = 'pulse' | 'traditional';
type Tab = 'watchlist' | 'attention' | 'replay';

/**
 * Slower than the watchlist re-reads.
 *
 * The feed is something a person is reading, not a number they are watching.
 * Re-ordering a list of stories under someone mid-sentence is worse than being
 * a few seconds behind, and the banner tells them what arrived either way.
 */
const FEED_POLL_MS = 8000;

export function App() {
  const [user, setUser] = useState('demo');
  const [view, setView] = useState<View>('pulse');
  const [tab, setTab] = useState<Tab>('watchlist');
  const [acknowledging, setAcknowledging] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const load = useCallback((signal: AbortSignal) => fetchFeed(user, signal), [user]);
  const { data: feed, error, refresh } = usePoll<AttentionFeedResponse>(load, FEED_POLL_MS);

  /**
   * The log head when this feed was first shown, so the page can say what
   * arrived while it was open rather than only showing a different list than
   * the one the reader started with.
   *
   * Reset when the user changes: a different reader is a different question.
   */
  const [openedAt, setOpenedAt] = useState<{ user: string; sequence: number } | undefined>(
    undefined,
  );
  if (feed !== undefined && openedAt?.user !== feed.userId) {
    // Keyed on the *response's* user, not the input box. A poll keeps the
    // previous reader's feed on screen until the new one lands, so keying on
    // the box would take the baseline from the wrong person's numbers.
    setOpenedAt({ user: feed.userId, sequence: feed.throughSequence });
  }
  const arrived =
    feed === undefined || openedAt?.user !== feed.userId
      ? 0
      : feed.throughSequence - openedAt.sequence;

  /**
   * Acknowledging is an explicit action, never a side effect of rendering.
   *
   * The server refuses to advance the watermark on a read, so this button is
   * the only thing that can consume the feed. That is the point: a user who
   * reloads, or whose connection drops mid-render, still has everything waiting
   * for them.
   */
  const onAcknowledge = () => {
    if (feed === undefined) return;
    setAcknowledging(true);
    acknowledge(user, feed.throughSequence)
      .then(() => {
        setActionError(undefined);
        refresh();
      })
      .catch((cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : 'Unknown error');
      })
      .finally(() => setAcknowledging(false));
  };

  return (
    <>
      <Header tab={tab} onTabChange={setTab} user={user} onUserChange={setUser} />
      {/*
        The other half of the tabs pattern. The header's tabs point here with
        aria-controls; without a panel to point at, those roles promised a
        relationship assistive technology could not find.

        `tabIndex={-1}` rather than 0: the panel is a focus *target* for the
        arrow-key navigation in the header, not another stop in the tab order.
      */}
      <main
        className="shell"
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
        tabIndex={-1}
      >
        <MarketStatus />

        {tab === 'watchlist' && (
          <>
            <h1>My watchlist</h1>
            <Watchlist userId={user} onViewChanges={() => setTab('attention')} />
          </>
        )}

        {tab === 'replay' && (
          <>
            <h1>What actually happened</h1>
            <p className="subtitle">
              The same history, stepped through in the order it was recorded. Watching it changes
              nothing — not the events, and not your read position.
            </p>
            <ReplayView />
          </>
        )}

        {tab === 'attention' && feed === undefined && error === undefined && (
          <p className="muted">Checking what you missed…</p>
        )}

        {tab === 'attention' && feed === undefined && error !== undefined && (
          <>
            <h1>Something went wrong</h1>
            <p className="subtitle">{error}</p>
            <p className="muted">
              Is the API running? Try <code>npm run dev</code>, then <code>npm run db:seed</code>.
            </p>
          </>
        )}

        {tab === 'attention' && feed !== undefined && (
          <>
            <h1>
              {feed.summary.meaningfulChanges === 0
                ? 'You are all caught up'
                : 'While you were away'}
            </h1>
            <p className="subtitle">
              {feed.summary.meaningfulChanges === 0
                ? 'Nothing has crossed the significance threshold since you last checked.'
                : `${pluralise(feed.summary.meaningfulChanges, 'meaningful change')} across ${pluralise(
                    feed.summary.instruments.length,
                    'instrument',
                  )}.`}
            </p>

            {arrived > 0 && (
              <p className="arrived" role="status">
                {pluralise(arrived, 'change')} arrived while this page was open. The market kept
                moving; your read position did not.
              </p>
            )}

            {feed.events.length > 0 && (
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
                  <AttentionFeed feed={feed} />
                ) : (
                  <TraditionalWatchlist feed={feed} />
                )}
              </>
            )}

            {feed.events.length === 0 && (
              <div className="card empty">
                <div className="tick" aria-hidden="true">
                  ✓
                </div>
                <p>
                  Read position {feed.sinceSequence} of {feed.throughSequence}.
                </p>
                <p className="muted">
                  Try another user in the header above — the log is shared, but each person&rsquo;s
                  position in it is their own. <code>priya</code> was seeded partway through it.
                </p>
              </div>
            )}

            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={onAcknowledge}
                disabled={acknowledging || feed.events.length === 0}
              >
                {acknowledging ? 'Marking…' : 'Mark all as read'}
              </button>
            </div>

            {actionError !== undefined && (
              <p className="muted">
                Nothing was marked as read — {actionError}. Your position is unchanged.
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
