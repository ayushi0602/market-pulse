import type { AttentionFeedResponse, FeedEvent } from '@market-pulse/domain';
import { DEFAULT_RULE } from '@market-pulse/domain';
import { formatPercent, formatPrice, formatTime, pluralise } from './format.js';
import { StoryPath } from './StoryPath.jsx';

/**
 * Ranking and narrative are different jobs, so they are different structures.
 *
 * Which instrument to look at first is a ranking question, answered by the
 * largest move. What happened to it is a narrative question, answered in the
 * order events were recorded. Making one flat list do both was the source of a
 * real oddity: RELIANCE's recovery outranked the decline that caused it, so the
 * feed read backwards.
 *
 * Grouping fixes it without touching the ranking rule. Instruments are still
 * ordered by their largest move; inside each one, events run chronologically.
 */
interface InstrumentStory {
  readonly instrumentId: string;
  readonly events: readonly FeedEvent[];
  readonly largestMoveBps: number;
}

function groupIntoStories(events: readonly FeedEvent[]): readonly InstrumentStory[] {
  const byInstrument = new Map<string, FeedEvent[]>();
  for (const event of events) {
    const existing = byInstrument.get(event.instrumentId);
    if (existing === undefined) {
      byInstrument.set(event.instrumentId, [event]);
    } else {
      existing.push(event);
    }
  }

  return (
    [...byInstrument.entries()]
      .map(([instrumentId, group]) => ({
        instrumentId,
        // Chronological within the story: this is the narrative axis.
        events: [...group].sort((a, b) => a.sequence - b.sequence),
        largestMoveBps: Math.max(...group.map((e) => e.magnitudeBps)),
      }))
      // Ranked between stories: this is the attention axis.
      .sort((a, b) => b.largestMoveBps - a.largestMoveBps)
  );
}

/**
 * Why the system judged this worth surfacing.
 *
 * The brief left "what counts as meaningful" to us, so the threshold should not
 * be invisible. Showing the anchor, the move and the rule turns a number the
 * reviewer has to trust into one they can check. Collapsed by default — it
 * answers a question rather than competing with the headline.
 */
function WhySignificant({ event }: { event: FeedEvent }) {
  const threshold = DEFAULT_RULE.thresholdBps;
  return (
    <details className="why">
      <summary>Why is this significant?</summary>
      <div className="why-body">
        <div className="why-row">
          <span>Anchor when the move began</span>
          <b>{formatPrice(event.fromPrice)}</b>
        </div>
        <div className="why-row">
          <span>Price at the crossing</span>
          <b>{formatPrice(event.toPrice)}</b>
        </div>
        <div className="why-row">
          <span>Move from the anchor</span>
          <b>{formatPercent(event.magnitudeBps, false)}</b>
        </div>
        <div className="why-row">
          <span>Threshold in force</span>
          <b>{formatPercent(threshold, false)}</b>
        </div>
        <p className="why-note">
          {formatPercent(event.magnitudeBps, false)} reached the {formatPercent(threshold, false)}{' '}
          threshold, so the transition was recorded and the anchor moved to{' '}
          {formatPrice(event.toPrice)}. It records the move that crossed the threshold — not the
          full run, if the price kept going.
        </p>
      </div>
    </details>
  );
}

export function AttentionFeed({ feed }: { feed: AttentionFeedResponse }) {
  const stories = groupIntoStories(feed.events);
  const flat = feed.summary.instruments.filter((i) => i.netChangeBps === 0);

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, marginBottom: '0.875rem' }}>
        Instruments ranked by their largest move; each story runs in the order it happened.
        Positions {feed.sinceSequence + 1}–{feed.throughSequence} of the shared event log.
      </p>

      {stories.map((story) => (
        <section className="card story-card" key={story.instrumentId}>
          <header className="story-head">
            <div>
              <div className="symbol">{story.instrumentId}</div>
              <div className="muted" style={{ fontSize: '0.875rem' }}>
                {pluralise(story.events.length, 'meaningful change')}
              </div>
            </div>
            <StoryPath events={story.events} />
          </header>

          <ol className="story-events">
            {story.events.map((event) => (
              <li key={event.eventId} className={`story-event ${event.direction}`}>
                <div className="arrow" aria-hidden="true">
                  {event.direction === 'decline' ? '↓' : '↑'}
                </div>
                <div className="story-event-body">
                  <p className="headline">
                    {event.direction === 'decline' ? 'Fell' : 'Recovered'}{' '}
                    {formatPercent(event.magnitudeBps, false)}
                  </p>
                  <div className="prices">
                    {formatPrice(event.fromPrice)} → {formatPrice(event.toPrice)}
                  </div>
                  <div className="meta">
                    {formatTime(event.occurredAt)} — you were not watching.
                  </div>
                  <WhySignificant event={event} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}

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
    </div>
  );
}

/**
 * What a traditional watchlist would say, computed from the same events.
 *
 * Deliberately not a strawman: for an instrument that genuinely moved it is a
 * perfectly good answer. The point is only that it is silent about everything
 * in between.
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
              <div className="row-end">
                <div className="big-number">{formatPrice(instrument.latestPrice)}</div>
                <div
                  style={{
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    color: isFlat
                      ? undefined
                      : instrument.netChangeBps < 0
                        ? 'var(--decline)'
                        : 'var(--advance)',
                  }}
                  className={isFlat ? 'flat' : undefined}
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
            {pluralise(feed.summary.meaningfulChanges, 'meaningful change')} happened while you were
            away. This view compares two prices and discards everything in between, so it cannot
            show them — however large they were.
          </span>
        </p>
      </div>
    </div>
  );
}
