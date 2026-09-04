import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  instrumentId,
  observeTicks,
  rupees,
  sequentialIds,
  userId,
  type AttentionFeedResponse,
  type MarketTick,
} from '@market-pulse/domain';
import { openDatabase, type Database } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { createEventStore } from '../src/modules/market/event-store.js';
import { createWatermarkStore } from '../src/modules/attention/watermark-store.js';

const RELIANCE = instrumentId('RELIANCE');
const INFY = instrumentId('INFY');
const START = 1_700_000_000_000;
const clock = { now: () => START };

function ticks(instrument: typeof RELIANCE, prices: number[]): MarketTick[] {
  return prices.map((price, index) => ({
    instrumentId: instrument,
    price: rupees(price),
    at: START + index * 60_000,
  }));
}

let db: Database;
let app: Express;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  app = createApp({ db, version: '0.0.1', clock });
  // The golden scenario, plus one unrelated instrument, as durable history.
  const store = createEventStore(db, sequentialIds(), clock);
  store.append(observeTicks(ticks(RELIANCE, [100, 96, 91, 95, 100])).events);
  store.append(observeTicks(ticks(INFY, [100, 80])).events);
});

afterEach(() => {
  db.close();
});

async function feed(user: string): Promise<AttentionFeedResponse> {
  const response = await request(app).get('/api/attention-feed').query({ userId: user });
  expect(response.status).toBe(200);
  return response.body as AttentionFeedResponse;
}

describe('the returning user', () => {
  it('is told what happened while they were away', async () => {
    const body = await feed('alice');

    expect(body.sinceSequence).toBe(0);
    expect(body.throughSequence).toBe(3);
    expect(body.summary.meaningfulChanges).toBe(3);

    const reliance = body.summary.instruments.find((i) => i.instrumentId === 'RELIANCE');
    // The whole argument, over HTTP: no net change, two meaningful changes.
    expect(reliance?.netChangeBps).toBe(0);
    expect(reliance?.meaningfulChanges).toBe(2);
  });

  it('ranks the feed by significance, not recency', async () => {
    const body = await feed('alice');
    // INFY fell 20%; RELIANCE moved 9% and 9.89%. Newest-first would put the
    // 9.89% recovery on top.
    expect(body.events.map((e) => e.magnitudeBps)).toEqual([2000, 989, 900]);
    expect(body.events[0]?.instrumentId).toBe('INFY');
  });

  it('carries positive magnitudes with a separate direction', async () => {
    const body = await feed('alice');
    for (const event of body.events) {
      expect(event.magnitudeBps).toBeGreaterThan(0);
      expect(['decline', 'advance']).toContain(event.direction);
    }
  });

  it('rejects a request with no user', async () => {
    await request(app).get('/api/attention-feed').expect(400);
    await request(app).get('/api/attention-feed').query({ userId: '  ' }).expect(400);
  });
});

describe('F1: fetching the feed never advances the watermark', () => {
  it('leaves the watermark untouched across repeated reads', async () => {
    const watermarks = createWatermarkStore(db, clock);

    await feed('alice');
    await feed('alice');
    await feed('alice');

    expect(watermarks.get(userId('alice')).lastSeenSequence).toBe(0);
    // The same events are still there on the fourth read. A user who reloads
    // must not lose what they came back to see.
    expect((await feed('alice')).events).toHaveLength(3);
  });

  it('creates no watermark row merely by reading', async () => {
    await feed('alice');
    const count = db.prepare('SELECT COUNT(*) AS n FROM user_read_watermarks').get();
    expect(count).toEqual({ n: 0 });
  });
});

describe('F2: acknowledging advances the watermark', () => {
  it('advances to the acknowledged position', async () => {
    const before = await feed('alice');

    const ack = await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'alice', throughSequence: before.throughSequence })
      .expect(200);
    expect(ack.body).toEqual({ userId: 'alice', lastSeenSequence: 3 });

    const after = await feed('alice');
    expect(after.sinceSequence).toBe(3);
    expect(after.events).toHaveLength(0);
    expect(after.summary.meaningfulChanges).toBe(0);
  });

  it('supports acknowledging only part of the feed', async () => {
    await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'alice', throughSequence: 1 })
      .expect(200);

    const after = await feed('alice');
    expect(after.sinceSequence).toBe(1);
    expect(after.events.map((e) => e.sequence).sort()).toEqual([2, 3]);
  });

  it('rejects a malformed acknowledgement', async () => {
    const bad = [
      { throughSequence: 1 },
      { userId: 'alice' },
      { userId: 'alice', throughSequence: 'two' },
      { userId: 'alice', throughSequence: 1.5 },
      { userId: 'alice', throughSequence: -1 },
    ];
    for (const body of bad) {
      await request(app).post('/api/attention-feed/ack').send(body).expect(400);
    }
  });
});

describe('F3: acknowledging a stale position cannot move backwards', () => {
  it('keeps the higher position when an older client reports a lower one', async () => {
    await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'alice', throughSequence: 3 })
      .expect(200);

    // A second tab, opened before the first acknowledged, reports what it saw.
    const stale = await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'alice', throughSequence: 1 })
      .expect(200);

    expect(stale.body).toEqual({ userId: 'alice', lastSeenSequence: 3 });
    expect((await feed('alice')).events).toHaveLength(0);
  });
});

describe('F4: the feed contains only events after the watermark', () => {
  it('excludes everything already acknowledged', async () => {
    await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'alice', throughSequence: 2 })
      .expect(200);

    const body = await feed('alice');
    expect(body.events.every((e) => e.sequence > 2)).toBe(true);
  });

  it('gives two users different feeds from the same log at the same instant', async () => {
    await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'bob', throughSequence: 3 })
      .expect(200);

    expect((await feed('alice')).events).toHaveLength(3);
    expect((await feed('bob')).events).toHaveLength(0);

    // One user reading changed nothing for the other, and nothing in the log.
    const count = db.prepare('SELECT COUNT(*) AS n FROM market_events').get();
    expect(count).toEqual({ n: 3 });
  });

  it('shows only newly arrived events after acknowledgement', async () => {
    await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'alice', throughSequence: 3 })
      .expect(200);

    createEventStore(db, sequentialIds('late'), clock).append(
      observeTicks(ticks(RELIANCE, [100, 120])).events,
    );

    const body = await feed('alice');
    expect(body.events.map((e) => e.sequence)).toEqual([4]);
    expect(body.sinceSequence).toBe(3);
  });
});

describe('F5: the feed ranking is deterministic', () => {
  it('returns the same order on every request', async () => {
    const orders = [];
    for (let i = 0; i < 10; i += 1) {
      orders.push((await feed('alice')).events.map((e) => e.sequence));
    }
    for (const order of orders) {
      expect(order).toEqual(orders[0]);
    }
  });
});
