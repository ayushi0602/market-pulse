import type { AttentionFeedResponse } from '@market-pulse/domain';
import { formatPercent, formatPrice, formatTime, pluralise } from './format.js';

/**
 * What Market Pulse says: the transitions that happened while you were away,
 * most significant first.
 */
export function AttentionFeed({ feed }: { feed: AttentionFeedResponse }) {
  const flat = feed.summary.instruments.filter((i) => i.netChangeBps === 0);

  return (
    <div>
      {feed.events.map((event) => {
        const verb = event.direction === 'decline' ? 'Fell' : 'Recovered';
        return (
          <article key={event.eventId} className={`card event ${event.direction}`}>
            <div className="arrow" aria-hidden="true">
              {event.direction === 'decline' ? '↓' : '↑'}
            </div>
            <div>
              <div className="symbol">{event.instrumentId}</div>
              <p className="headline">
                {verb} {formatPercent(event.magnitudeBps, false)}
              </p>
              <div className="prices">
                {formatPrice(event.fromPrice)} → {formatPrice(event.toPrice)}
              </div>
              <div className="meta">
                Crossed the significance threshold at {formatTime(event.occurredAt)}. You were not
                watching.
              </div>
            </div>
          </article>
        );
      })}

      {flat.length > 0 && (
        <div className="punchline">
          <p>
            <strong>Why this matters</strong>
            <span className="muted">
              {flat.map((i) => i.instrumentId).join(', ')} ended where{' '}
              {flat.length === 1 ? 'it' : 'they'} started. A watchlist comparing the current price
              against your last snapshot would have shown you 0.00% and nothing else.
            </span>
          </p>
        </div>
      )}

      <p className="muted" style={{ marginTop: '1.5rem' }}>
        Ranked by significance, not recency. Positions {feed.sinceSequence + 1}–
        {feed.throughSequence} of the shared event log.
      </p>
    </div>
  );
}

/**
 * What a traditional watchlist would say, computed from exactly the same events.
 *
 * Deliberately not a strawman: this is the honest snapshot answer, and for the
 * instruments that genuinely moved it is a perfectly good one. The point is only
 * that it is silent about everything that happened in between.
 */
export function TraditionalWatchlist({ feed }: { feed: AttentionFeedResponse }) {
  return (
    <div>
      <div className="card">
        {feed.summary.instruments.map((instrument) => {
          const isFlat = instrument.netChangeBps === 0;
          return (
            <div className="row" key={instrument.instrumentId}>
              <div>
                <div className="symbol">{instrument.instrumentId}</div>
                <div className="muted">
                  {isFlat ? 'No change since your last check' : 'Since your last check'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="big-number">{formatPrice(instrument.latestPrice)}</div>
                <div
                  className={
                    isFlat ? 'flat' : instrument.netChangeBps < 0 ? 'headline' : 'headline'
                  }
                  style={{
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    color: isFlat
                      ? undefined
                      : instrument.netChangeBps < 0
                        ? 'var(--decline)'
                        : 'var(--advance)',
                  }}
                >
                  {formatPercent(instrument.netChangeBps)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="punchline">
        <p>
          <strong>What this view cannot tell you</strong>
          <span className="muted">
            {pluralise(feed.summary.meaningfulChanges, 'meaningful transition')} happened while you
            were away. This view compares two prices and discards everything in between, so it
            cannot show them — however large they were.
          </span>
        </p>
      </div>
    </div>
  );
}
