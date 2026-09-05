import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  instrumentId,
  paise,
  sequentialIds,
  userId,
  type AttentionFeedResponse,
  type MeaningfulMarketEvent,
  type WatchlistResponse,
} from '@market-pulse/domain';
import { openDatabase, type Database } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { createEventStore } from '../src/modules/market/event-store.js';
import { createSnapshotStore } from '../src/modules/market/snapshot-store.js';
import { createWatchlistStore } from '../src/modules/watchlist/watchlist-store.js';
import { BENCHMARK_SYMBOL } from '../src/modules/market/catalogue.js';

const START = 1_700_000_000_000;
const clock = { now: () => START };
const BENCHMARK = instrumentId(BENCHMARK_SYMBOL);

function move(instrument: string, index: number): MeaningfulMarketEvent {
  return {
    instrumentId: instrumentId(instrument),
    direction: index % 2 === 0 ? 'decline' : 'advance',
    fromPrice: paise(100_000),
    // A magnitude that varies with the index, so ranking has something to do.
    toPrice: paise(index % 2 === 0 ? 94_000 : 106_000),
    magnitudeBps: 500 + (index % 40),
    occurredAt: START + index * 1_000,
  };
}

let db: Database;
let app: Express;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  app = createApp({ db, version: '0.0.1', clock });
});

afterEach(() => {
  db.close();
});

/**
 * The unread window has no upper bound -- the longer someone is away, which is
 * this product's premise, the more there is. Measured before the cap: a
 * 20,000-event log produced a 4.4 MB response, re-fetched on every poll.
 */
describe('the feed is a page, and says so', () => {
  beforeEach(() => {
    const events = createEventStore(db, sequentialIds(), clock);
    const batch = Array.from({ length: 300 }, (_, i) => move(`SYM${i % 12}`, i));
    events.append(batch);
  });

  async function feed(): Promise<AttentionFeedResponse> {
    const response = await request(app).get('/api/attention-feed').query({ userId: 'reader' });
    expect(response.status).toBe(200);
    return response.body as AttentionFeedResponse;
  }

  it('caps the events it returns', async () => {
    const body = await feed();

    expect(body.events).toHaveLength(body.eventLimit);
    expect(body.events.length).toBeLessThan(300);
  });

  it('keeps the summary counts covering the WHOLE window, not the page', async () => {
    const body = await feed();

    // The number a reader is shown -- "300 meaningful changes across 12
    // instruments" -- must describe what happened, not how much of it fitted
    // in one response. A count that quietly meant "of the page you were sent"
    // is the same class of dishonesty this product exists to avoid.
    expect(body.summary.meaningfulChanges).toBe(300);
    expect(body.summary.instruments).toHaveLength(12);

    const perInstrument = body.summary.instruments.reduce(
      (total, entry) => total + entry.meaningfulChanges,
      0,
    );
    expect(perInstrument).toBe(300);
  });

  it('still returns the most significant events, not merely the first page of them', async () => {
    const body = await feed();

    const magnitudes = body.events.map((event) => event.magnitudeBps);
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a));
    // The largest move in the log is present despite the cap.
    expect(magnitudes[0]).toBe(539);
  });

  it('acknowledges the whole window, never just the page shown', async () => {
    const body = await feed();

    // Events are ranked by magnitude, so the page is not a prefix of the log
    // and no sequence describes "the 50 you saw". Acknowledging the page would
    // strand the rest permanently, because watermarks only move forward.
    expect(body.throughSequence).toBe(300);

    const ack = await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'reader', throughSequence: body.throughSequence });
    expect(ack.status).toBe(200);

    const after = await feed();
    expect(after.summary.meaningfulChanges).toBe(0);
  });
});

/**
 * The acknowledgement boundary used to come from a second `events.head()` call
 * made after the unread records were read. That was safe only because
 * node:sqlite is synchronous; one `await` in the handler and an event landing
 * between the two reads would be acknowledged without ever being shown.
 */
describe('F6b: the acknowledgement boundary comes from the records that were read', () => {
  it('reaches the head even when the newest events are benchmark events', async () => {
    const events = createEventStore(db, sequentialIds(), clock);
    events.append([move('RELIANCE', 0)]);
    // The benchmark moving last is the case that breaks a naive fix: the feed
    // filters these out, so deriving the boundary from the *filtered* list
    // would leave them permanently unreachable and the watermark would never
    // catch up to the log.
    events.append([move(BENCHMARK, 1), move(BENCHMARK, 2)]);

    const response = await request(app).get('/api/attention-feed').query({ userId: 'reader' });
    const body = response.body as AttentionFeedResponse;

    expect(body.throughSequence).toBe(3);
    // The benchmark's own events are still not things to read.
    expect(body.events.map((event) => event.instrumentId)).toEqual(['RELIANCE']);

    const ack = await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'reader', throughSequence: body.throughSequence });
    expect(ack.status).toBe(200);
    expect((ack.body as { lastSeenSequence: number }).lastSeenSequence).toBe(3);
  });

  it('leaves the boundary at the watermark when there is nothing unread', async () => {
    const response = await request(app).get('/api/attention-feed').query({ userId: 'reader' });
    const body = response.body as AttentionFeedResponse;

    expect(body.sinceSequence).toBe(0);
    expect(body.throughSequence).toBe(0);
  });
});

/**
 * The watchlist read was `readAfter(watermark)` plus `snapshots.list()` -- the
 * whole log and every snapshot -- with buildWatchlist discarding the surplus.
 * Scoping the reads must not change a single byte of the answer.
 */
describe('the watchlist reads only what the user follows', () => {
  it('answers identically whether or not unfollowed instruments have events', async () => {
    const events = createEventStore(db, sequentialIds(), clock);
    const snapshots = createSnapshotStore(db, clock);
    const watchlist = createWatchlistStore(db, clock);

    watchlist.add(userId('reader'), instrumentId('RELIANCE'));
    events.append([move('RELIANCE', 0)]);
    snapshots.record(instrumentId('RELIANCE'), 94_000, START);

    const before = await request(app).get('/api/watchlist').query({ userId: 'reader' });

    // A great deal of noise about instruments this user does not follow.
    events.append(Array.from({ length: 200 }, (_, i) => move(`OTHER${i % 20}`, i + 10)));
    for (let i = 0; i < 20; i++) snapshots.record(instrumentId(`OTHER${i}`), 50_000, START);

    const after = await request(app).get('/api/watchlist').query({ userId: 'reader' });

    expect(after.body).toEqual(before.body);
    expect((after.body as WatchlistResponse).rows).toHaveLength(1);
  });

  it('answers an empty watchlist without reading the log', async () => {
    const events = createEventStore(db, sequentialIds(), clock);
    events.append(Array.from({ length: 50 }, (_, i) => move(`SYM${i % 5}`, i)));

    // An empty follow list must produce no rows rather than an invalid `IN ()`.
    const response = await request(app).get('/api/watchlist').query({ userId: 'nobody' });

    expect(response.status).toBe(200);
    expect((response.body as WatchlistResponse).rows).toEqual([]);
  });
});

describe('the feed reconciles its price with the watchlist', () => {
  it('carries the latest observation alongside the price at the last event', async () => {
    const events = createEventStore(db, sequentialIds(), clock);
    const snapshots = createSnapshotStore(db, clock);

    events.append([move('RELIANCE', 0)]);
    // The market kept moving after the last threshold crossing, which is the
    // ordinary case with a generator running -- and the reason the two screens
    // used to disagree with no explanation.
    snapshots.record(instrumentId('RELIANCE'), 91_234, START + 60_000);

    const response = await request(app).get('/api/attention-feed').query({ userId: 'reader' });
    const summary = (response.body as AttentionFeedResponse).summary.instruments[0];

    expect(summary?.latestPrice).toBe(94_000);
    expect(summary?.observedPrice).toBe(91_234);
    expect(summary?.observedAt).toBe(START + 60_000);
  });

  it('reports no observation rather than inventing one', async () => {
    const events = createEventStore(db, sequentialIds(), clock);
    events.append([move('NEVEROBSERVED', 0)]);

    const response = await request(app).get('/api/attention-feed').query({ userId: 'reader' });
    const summary = (response.body as AttentionFeedResponse).summary.instruments[0];

    expect(summary?.observedPrice).toBeUndefined();
    expect(summary?.observedAt).toBeUndefined();
  });
});
