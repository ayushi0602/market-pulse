import { useEffect, useMemo, useState } from 'react';
import type { FeedEvent, RecordedMarketEvent } from '@market-pulse/domain';
import {
  advance,
  createReplay,
  eventId,
  instrumentId,
  isComplete,
  netChangeAtCursor,
  openingPrice,
  paise,
  priceAtCursor,
  revealed,
} from '@market-pulse/domain';
import { fetchReplay } from './api.js';
import { StoryPath } from './StoryPath.jsx';
import { formatPercent, formatPrice, formatTime, pluralise } from './format.js';

/** The wire shape back into the domain shape the replay projection works on. */
function toRecord(event: FeedEvent): RecordedMarketEvent {
  return {
    eventId: eventId(event.eventId),
    sequence: event.sequence,
    event: {
      instrumentId: instrumentId(event.instrumentId),
      direction: event.direction,
      fromPrice: paise(event.fromPrice),
      toPrice: paise(event.toPrice),
      magnitudeBps: event.magnitudeBps,
      occurredAt: event.occurredAt,
    },
  };
}

/** Back to the wire shape, so the story drawing has one input type. */
function toFeedEvent(record: RecordedMarketEvent): FeedEvent {
  return {
    eventId: record.eventId,
    sequence: record.sequence,
    instrumentId: record.event.instrumentId,
    direction: record.event.direction,
    fromPrice: record.event.fromPrice,
    toPrice: record.event.toPrice,
    magnitudeBps: record.event.magnitudeBps,
    occurredAt: record.event.occurredAt,
  };
}

export interface ReplayViewProps {
  instrumentId: string;
  /** Milliseconds between auto-advanced steps. A parameter so tests can drive it. */
  stepIntervalMs?: number;
}

/**
 * Watch the story instead of reading it.
 *
 * Three controls and no more. A playback-rate engine, a seek bar and a timeline
 * widget would all be plausible and none of them would make the point better
 * than "the price came back and the events did not go away".
 *
 * The cursor lives here, in the client. Everything it steps over is a frozen
 * copy of canonical history, so nothing this component does can alter what
 * happened or what any user has read.
 */
export function ReplayView({ instrumentId: symbol, stepIntervalMs = 1400 }: ReplayViewProps) {
  const [timeline, setTimeline] = useState<readonly FeedEvent[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchReplay(symbol, controller.signal)
      .then((response) => setTimeline(response.timeline))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Unknown error');
      });
    return () => controller.abort();
  }, [symbol]);

  const replay = useMemo(() => {
    const base = createReplay((timeline ?? []).map(toRecord));
    // Rebuild at the current cursor: the projection is a pure function of
    // (timeline, cursor), so this is the whole of the replay state.
    let at = base;
    for (let i = 0; i < cursor; i += 1) {
      at = advance(at);
    }
    return at;
  }, [timeline, cursor]);

  const complete = isComplete(replay);

  // Derived rather than stored: "playing but finished" is not a state the
  // component can be in, so it is computed instead of being corrected by an
  // effect. Writing state inside an effect to fix up other state is what causes
  // cascading renders.
  const activelyPlaying = playing && !complete;

  useEffect(() => {
    if (!activelyPlaying) {
      return;
    }
    const timer = setTimeout(() => setCursor((c) => c + 1), stepIntervalMs);
    return () => clearTimeout(timer);
  }, [activelyPlaying, cursor, stepIntervalMs]);

  if (error !== undefined) {
    return <p className="muted">Could not load the replay — {error}</p>;
  }
  if (timeline === undefined) {
    return <p className="muted">Loading the story…</p>;
  }
  if (timeline.length === 0) {
    return (
      <div className="card empty">
        <p>{symbol} never crossed the significance threshold.</p>
        <p className="muted">There is no story to replay, which is itself the answer.</p>
      </div>
    );
  }

  const opening = openingPrice(replay);
  const current = priceAtCursor(replay);
  const net = netChangeAtCursor(replay);
  const shown = revealed(replay);

  return (
    <div>
      <div className="card">
        <div className="row">
          <div>
            <div className="symbol">{symbol}</div>
            <div className="muted">
              {cursor === 0
                ? 'Before you left'
                : complete
                  ? 'Where it ended'
                  : `Step ${cursor} of ${timeline.length}`}
            </div>
          </div>
          <div className="row-end">
            <div className="big-number">{current === undefined ? '—' : formatPrice(current)}</div>
            <div
              className="muted"
              style={{
                fontWeight: 600,
                color: net === 0 ? undefined : net < 0 ? 'var(--decline)' : 'var(--advance)',
              }}
              data-testid="replay-net"
            >
              {formatPercent(net)} vs {opening === undefined ? '—' : formatPrice(opening)}
            </div>
          </div>
        </div>
      </div>

      {shown.length > 0 && (
        <div className="card replay-story">
          {/* The same shape the feed draws, filling in as the cursor moves. */}
          <StoryPath events={shown.map((r) => toFeedEvent(r))} />
        </div>
      )}

      <ol className="timeline">
        {shown.map((record) => (
          <li key={record.eventId} className={`card event ${record.event.direction}`}>
            <div className="arrow" aria-hidden="true">
              {record.event.direction === 'decline' ? '↓' : '↑'}
            </div>
            <div>
              <div className="muted">{formatTime(record.event.occurredAt)}</div>
              <p className="headline">
                {record.event.direction === 'decline' ? 'Fell' : 'Recovered'}{' '}
                {formatPercent(record.event.magnitudeBps, false)}
              </p>
              <div className="prices">
                {formatPrice(record.event.fromPrice)} → {formatPrice(record.event.toPrice)}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {complete && (
        <div className="punchline">
          <p>
            <strong>The price went nowhere. The story did not.</strong>
            <span className="muted">
              {symbol} ended at {current === undefined ? '—' : formatPrice(current)} —{' '}
              {formatPercent(net)} against where it started. A snapshot taken now would show you
              that number and nothing else, and{' '}
              {pluralise(timeline.length, 'meaningful transition')} would be invisible.
            </span>
          </p>
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => setPlaying((p) => !p)}
          disabled={complete}
        >
          {activelyPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button type="button" onClick={() => setCursor((c) => c + 1)} disabled={complete}>
          ⏭ Next
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setCursor(0);
          }}
          disabled={cursor === 0}
        >
          ↺ Restart
        </button>
      </div>
    </div>
  );
}
