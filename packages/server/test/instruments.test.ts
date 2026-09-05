import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { InstrumentCatalogueResponse, WatchlistResponse } from '@market-pulse/domain';
import { openDatabase, type Database } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { createSnapshotStore } from '../src/modules/market/snapshot-store.js';
import { createSimulator } from '../src/modules/market/simulator.js';
import { createEventStore } from '../src/modules/market/event-store.js';
import { uuidEventIds } from '../src/ids.js';
import { BENCHMARK_SYMBOL, CATALOGUE } from '../src/modules/market/catalogue.js';

const START = 1_700_000_000_000;
const clock = { now: () => START };

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

describe('a symbol has a shape', () => {
  const rejected: [string, string][] = [
    ['300 characters', 'A'.repeat(300)],
    ['markup', '<script>alert(1)</script>'],
    ['a space', 'REL IANCE'],
    ['a quote', "REL'IANCE"],
    ['a slash', 'REL/IANCE'],
  ];

  for (const [what, symbol] of rejected) {
    it(`refuses ${what}`, async () => {
      const response = await request(app)
        .post('/api/watchlist')
        .send({ userId: 'judge', instrumentId: symbol });

      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toMatch(/1–20 characters/);
    });
  }

  const accepted = ['RELIANCE', 'M&M', 'BAJAJ-AUTO', 'TCS', 'X'];
  for (const symbol of accepted) {
    it(`accepts ${symbol}`, async () => {
      const response = await request(app)
        .post('/api/watchlist')
        .send({ userId: 'judge', instrumentId: symbol });

      expect(response.status).toBe(201);
    });
  }

  it('still lets a user follow a symbol this market does not trade', async () => {
    // The decision recorded in the UI footnote: an untraded symbol reads
    // "Never observed", which is honest. The shape check bounds the input
    // without reversing that.
    const response = await request(app)
      .post('/api/watchlist')
      .send({ userId: 'judge', instrumentId: 'NOTREAL' });

    expect(response.status).toBe(201);
    const rows = (response.body as WatchlistResponse).rows;
    expect(rows[0]?.instrumentId).toBe('NOTREAL');
    expect(rows[0]?.latestPrice).toBeUndefined();
  });

  it('still refuses the benchmark, whatever the case', async () => {
    for (const spelling of ['NIFTY', 'nifty', '  NiFtY  ']) {
      const response = await request(app)
        .post('/api/watchlist')
        .send({ userId: 'judge', instrumentId: spelling });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toMatch(/benchmark/);
    }
  });

  it('stores an ordinary symbol exactly as given, without folding case', async () => {
    await request(app).post('/api/watchlist').send({ userId: 'judge', instrumentId: 'reliance' });
    const response = await request(app).get('/api/watchlist').query({ userId: 'judge' });

    expect((response.body as WatchlistResponse).rows[0]?.instrumentId).toBe('reliance');
  });
});

describe('the market says what it trades', () => {
  it('lists the catalogue and flags the benchmark', async () => {
    const response = await request(app).get('/api/instruments');
    expect(response.status).toBe(200);

    const body = response.body as InstrumentCatalogueResponse;
    expect(body.instruments).toHaveLength(CATALOGUE.length);

    const benchmark = body.instruments.filter((entry) => entry.isBenchmark);
    expect(benchmark).toHaveLength(1);
    expect(benchmark[0]?.instrumentId).toBe(BENCHMARK_SYMBOL);
  });

  it('carries no user, so it cannot be a per-user list by accident', async () => {
    const anonymous = await request(app).get('/api/instruments');
    const withUser = await request(app).get('/api/instruments').query({ userId: 'judge' });

    expect(withUser.body).toEqual(anonymous.body);
  });
});

describe('pausing and resuming a market that has nothing to simulate', () => {
  it('refuses to report success for a resume that cannot happen', async () => {
    // A fresh clone: migrations have run, the seed has not. The generator
    // tracks only instruments it has already observed, so it tracks none.
    const snapshots = createSnapshotStore(db, clock);
    const events = createEventStore(db, uuidEventIds, clock);
    const withSimulator = createApp({
      db,
      version: '0.0.1',
      clock,
      createSimulation: () => createSimulator({ events, snapshots, clock, intervalMs: 3000 }),
    });

    const response = await request(withSimulator)
      .post('/api/market-status')
      .send({ running: true });

    // Previously 200 with running:false -- success reported for an operation
    // that did not occur, leaving the UI's Resume control inert and unexplained.
    expect(response.status).toBe(409);
    expect((response.body as { error: string }).error).toMatch(/db:seed/);
  });

  it('still allows pausing, which is always a real operation', async () => {
    const snapshots = createSnapshotStore(db, clock);
    const events = createEventStore(db, uuidEventIds, clock);
    const withSimulator = createApp({
      db,
      version: '0.0.1',
      clock,
      createSimulation: () => createSimulator({ events, snapshots, clock, intervalMs: 3000 }),
    });

    const response = await request(withSimulator)
      .post('/api/market-status')
      .send({ running: false });

    expect(response.status).toBe(200);
  });
});
