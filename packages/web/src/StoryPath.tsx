import type { FeedEvent } from '@market-pulse/domain';
import { formatPrice } from './format.js';

/**
 * The shape of what happened, drawn from the events themselves.
 *
 * Deliberately not a price chart. There is no tick data behind this and there
 * are no candlesticks to draw -- each vertex is a recorded threshold crossing,
 * so the line has exactly as many points as the system actually knows about.
 * Drawing anything smoother would imply data we do not have.
 *
 * The dashed horizontal is the snapshot reading: where the price started, and
 * where a watchlist comparing two numbers would say it still is. When the path
 * returns to that line with peaks in between, the picture makes the argument
 * without a caption.
 */
export function StoryPath({ events }: { events: readonly FeedEvent[] }) {
  const first = events[0];
  if (first === undefined) {
    return null;
  }

  // Prices in order: the first event's anchor, then each event's destination.
  const prices = [first.fromPrice, ...events.map((e) => e.toPrice)];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;

  const W = 100;
  const H = 34;
  const PAD = 4;

  const x = (i: number) => (prices.length === 1 ? W / 2 : (i / (prices.length - 1)) * W);
  const y = (price: number) => H - PAD - ((price - min) / span) * (H - PAD * 2);

  const points = prices.map((p, i) => ({ x: x(i), y: y(p) }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const startY = y(first.fromPrice);
  const endsWhereItStarted = prices[prices.length - 1] === first.fromPrice;

  return (
    <figure className="story">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="story-svg"
        role="img"
        aria-label={`${first.instrumentId} moved from ${formatPrice(first.fromPrice)} through ${events
          .map((e) => formatPrice(e.toPrice))
          .join(', ')}`}
      >
        {/* Where a snapshot comparison would say the price still is. */}
        <line
          x1="0"
          y1={startY}
          x2={W}
          y2={startY}
          className="story-baseline"
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
        <path d={path} className="story-line" fill="none" vectorEffect="non-scaling-stroke" />
        {/*
          Ticks, not dots. The viewBox is stretched to fill its container, so a
          circle renders as an ellipse -- x and y scale by different factors. A
          vertical mark with a non-scaling stroke is immune to that, and still
          marks where the price actually turned.
        */}
        {points.map((p, i) => (
          <line
            key={i}
            x1={p.x}
            y1={p.y - 2.5}
            x2={p.x}
            y2={p.y + 2.5}
            className={i === points.length - 1 ? 'story-tick story-tick-end' : 'story-tick'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <figcaption className="story-caption">
        {formatPrice(first.fromPrice)}
        <span aria-hidden="true"> → </span>
        {formatPrice(prices[prices.length - 1] ?? first.fromPrice)}
        {endsWhereItStarted && <em> — exactly where it started</em>}
      </figcaption>
    </figure>
  );
}
