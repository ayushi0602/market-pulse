import type { AttentionFeedResponse, FeedEvent, SignalClassification } from '@market-pulse/domain';
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
 * "Recovered" is a claim about what came before, so only say it when the story
 * says so.
 *
 * A single event knows its direction and nothing else. Calling every advance a
 * recovery was fine while RELIANCE was the only instrument with one, and became
 * wrong the moment the demo included a genuine rally: TATAMOTORS never fell, and
 * three rows in a row told the reader it had come back from something.
 *
 * Inside a story the events are chronological, so "was there a decline before
 * this one" is a question the grouped list can actually answer. When there was,
 * the word is earned; when there was not, the plain one is the true one.
 */
export function moveLabel(
  events: readonly FeedEvent[],
  index: number,
): 'Fell' | 'Rose' | 'Recovered' {
  const event = events[index];
  if (event === undefined || event.direction === 'decline') return 'Fell';
  return events.slice(0, index).some((earlier) => earlier.direction === 'decline')
    ? 'Recovered'
    : 'Rose';
}

/**
 * Is this glanceable, or does it only earn a place in the disclosure?
 *
 * `stock-specific` is the base rate -- most moves are specific to the
 * instrument that made them, and saying so on every card would be the exact
 * mistake already made once with "you were not watching" repeated twenty
 * times. It still gets a full, plain-language row inside "Why is this
 * significant?", because absence of a tag should never be the only way a
 * reader learns the market was calm. The two informative cases -- a move
 * that is not unique to this instrument, or one far larger than the
 * market's own -- surface here, where they are actually the exception.
 */
export function ContextTag({ context }: { context: SignalClassification | undefined }) {
  if (context === undefined || context === 'stock-specific') return null;
  const label = context === 'market-wide' ? 'Market-wide' : 'Outlier';
  return <span className={`context-tag context-tag-${context}`}>{label}</span>;
}

/**
 * Puts the classification in plain words, using the same benchmark numbers a
 * reader could check for themselves. Written once so the feed and replay's
 * disclosure never drift into describing the same verdict differently.
 */
function contextExplanation(context: SignalClassification | undefined): string {
  switch (context) {
    case 'market-wide':
      return 'The benchmark moved the same way by a comparable amount at the time — this instrument was doing what the wider market was doing.';
    case 'outlier':
      return 'The benchmark moved the same way, but by far less — this instrument moved well beyond what the wider market did.';
    case 'stock-specific':
      return 'The benchmark either moved the other way or had no comparable move recorded at the time — as far as this system knows, this was specific to the instrument.';
    case undefined:
      return 'This is the benchmark itself, so it is not compared against anything.';
  }
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
        <div className="why-row">
          <span>Market context</span>
          <b>
            {event.signalContext === undefined
              ? 'Not applicable'
              : event.signalContext === 'market-wide'
                ? 'Market-wide'
                : event.signalContext === 'outlier'
                  ? 'Outlier'
                  : 'Stock-specific'}
          </b>
        </div>
        <p className="why-note">{contextExplanation(event.signalContext)}</p>
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

      {/*
        The unread window is unbounded — the longer you are away, the more there
        is — so the response carries a page of it. Saying which page, and of
        what, is the difference between a limit and a quiet omission. The
        counts above are of the whole window, never of this page.
      */}
      {feed.events.length < feed.summary.meaningfulChanges && (
        <p className="muted truncation-note">
          Showing the {feed.events.length} largest of {feed.summary.meaningfulChanges} changes.{' '}
          <strong>Mark all as read</strong> still marks every one of them, not only those shown.
        </p>
      )}

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
            {story.events.map((event, index) => (
              <li key={event.eventId} className={`story-event ${event.direction}`}>
                <div className="arrow" aria-hidden="true">
                  {event.direction === 'decline' ? '↓' : '↑'}
                </div>
                <div className="story-event-body">
                  <p className="headline">
                    {moveLabel(story.events, index)} {formatPercent(event.magnitudeBps, false)}{' '}
                    <ContextTag context={event.signalContext} />
                  </p>
                  <div className="prices">
                    {formatPrice(event.fromPrice)} → {formatPrice(event.toPrice)}
                  </div>
                  {/* Just the time. "You were not watching" was true and, said
                      once per event, became twenty lines of the same sentence. */}
                  <div className="meta">{formatTime(event.occurredAt)}</div>
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
                  {isFlat
                    ? 'No change across what you missed'
                    : 'Net change across what you missed'}
                </div>
              </div>
              <div className="row-end">
                <div className="big-number">{formatPrice(instrument.latestPrice)}</div>
                <span
                  className={`pill ${
                    isFlat
                      ? 'pill-flat'
                      : instrument.netChangeBps < 0
                        ? 'pill-negative'
                        : 'pill-positive'
                  }`}
                >
                  {formatPercent(instrument.netChangeBps)}
                </span>
                {/*
                  The two screens used to disagree silently. This price is where
                  the *events* ended; "My watchlist" shows the latest
                  observation, and with a market running they diverge as soon as
                  a tick lands that does not cross the threshold — INFY read
                  ₹1,200.00 here and ₹1,176.61 there, at the same instant, with
                  nothing to explain it. Saying both is a stronger version of
                  this screen's own argument, not a weaker one.
                */}
                {instrument.observedPrice !== undefined &&
                  instrument.observedPrice !== instrument.latestPrice && (
                    <div className="muted observed">
                      now {formatPrice(instrument.observedPrice)}
                      {instrument.observedAt !== undefined && (
                        <> as recorded {formatTime(instrument.observedAt)}</>
                      )}
                    </div>
                  )}
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
