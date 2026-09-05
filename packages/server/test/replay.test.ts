import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  instrumentId,
  observeTicks,
  rupees,
  sequentialIds,
  userId,
  type MarketTick,
  type ReplayResponse,
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
  const store = createEventStore(db, sequentialIds(), clock);
  store.append(observeTicks(ticks(RELIANCE, [100, 96, 91, 95, 100])).events);
  store.append(observeTicks(ticks(INFY, [100, 80])).events);
});

afterEach(() => {
  db.close();
});

async function replay(instrument: string): Promise<ReplayResponse> {
  const response = await request(app).get('/api/replay').query({ instrumentId: instrument });
  expect(response.status).toBe(200);
  return response.body as ReplayResponse;
}

describe('the replay timeline', () => {
  it('returns one instrument’s story in sequence order', async () => {
    const body = await replay('RELIANCE');
    expect(body.instrumentId).toBe('RELIANCE');
    expect(body.timeline.map((e) => e.sequence)).toEqual([1, 2]);
    expect(body.timeline.map((e) => e.direction)).toEqual(['decline', 'advance']);
  });

  it('does not leak other instruments into the story', async () => {
    expect((await replay('INFY')).timeline.map((e) => e.sequence)).toEqual([3]);
  });

  it('returns an empty timeline for an instrument with no events', async () => {
    expect((await replay('TCS')).timeline).toEqual([]);
  });

  it('rejects a request with no instrument', async () => {
    await request(app).get('/api/replay').expect(400);
  });
});

describe('R5: replay does not touch user consumption state', () => {
  it('creates no watermark row, however many times it is replayed', async () => {
    for (let i = 0; i < 5; i += 1) {
      await replay('RELIANCE');
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM user_read_watermarks').get();
    expect(count).toEqual({ n: 0 });
  });

  it('leaves an existing watermark exactly where it was', async () => {
    const watermarks = createWatermarkStore(db, clock);
    watermarks.advanceTo(userId('alice'), 1);

    await replay('RELIANCE');
    await replay('INFY');

    expect(watermarks.get(userId('alice')).lastSeenSequence).toBe(1);
  });

  it('shows the whole story regardless of what the viewer has already read', async () => {
    createWatermarkStore(db, clock).advanceTo(userId('alice'), 3);
    // Alice has read everything. The replay is still the full story: it is a
    // projection of shared history, not a per-user feed.
    expect((await replay('RELIANCE')).timeline).toHaveLength(2);
  });
});

describe('R1: replay does not rewrite history', () => {
  it('leaves the event rows untouched', async () => {
    const before = db.prepare('SELECT * FROM market_events ORDER BY sequence').all();
    await replay('RELIANCE');
    await replay('INFY');
    expect(db.prepare('SELECT * FROM market_events ORDER BY sequence').all()).toEqual(before);
  });
});

describe('R2: replay responses are deterministic', () => {
  it('returns an identical timeline on every request', async () => {
    const runs = [];
    for (let i = 0; i < 8; i += 1) {
      runs.push(await replay('RELIANCE'));
    }
    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });
});

describe('SC: replay carries the same signal context as the feed', () => {
  const NIFTY = instrumentId('NIFTY');

  it("classifies replayed events against the benchmark, at each event's own time", async () => {
    const store = createEventStore(db, sequentialIds('sc'), clock);
    // NIFTY falls first, comparably to RELIANCE's decline in the golden
    // scenario -- market-wide -- then nothing else, so RELIANCE's later
    // recovery has no matching benchmark move and reads as stock-specific.
    store.append(observeTicks(ticks(NIFTY, [100, 92])).events);

    const timeline = (await replay('RELIANCE')).timeline;
    const decline = timeline.find((e) => e.direction === 'decline');
    const recovery = timeline.find((e) => e.direction === 'advance');
    expect(decline?.signalContext).toBe('market-wide');
    expect(recovery?.signalContext).toBe('stock-specific');
  });

  it('gives the benchmark itself no signal context', async () => {
    const store = createEventStore(db, sequentialIds('sc'), clock);
    store.append(observeTicks(ticks(NIFTY, [100, 90])).events);

    const timeline = (await replay('NIFTY')).timeline;
    expect(timeline.length).toBeGreaterThan(0);
    for (const event of timeline) {
      expect(event.signalContext).toBeUndefined();
    }
  });

  it('does not let a future benchmark event change the verdict on an earlier one (SC1)', async () => {
    const store = createEventStore(db, sequentialIds('sc'), clock);
    // The whole point of R1/R2: replaying later must not rewrite what an
    // earlier event's classification was. A benchmark decline recorded after
    // RELIANCE's own decline must not retroactively make it market-wide.
    store.append(
      observeTicks(
        ticks(NIFTY, [100, 90]).map((t, i) => ({ ...t, at: START + 20 * 60_000 + i * 60_000 })),
      ).events,
    );

    const timeline = (await replay('RELIANCE')).timeline;
    const decline = timeline.find((e) => e.direction === 'decline');
    expect(decline?.signalContext).toBe('stock-specific');
  });
});
