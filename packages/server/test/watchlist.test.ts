import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  instrumentId,
  observeTicks,
  rupees,
  sequentialIds,
  userId,
  type MarketTick,
  type WatchlistResponse,
} from '@market-pulse/domain';
import { openDatabase, type Database } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { createEventStore } from '../src/modules/market/event-store.js';
import { createSnapshotStore } from '../src/modules/market/snapshot-store.js';
import { createWatchlistStore } from '../src/modules/watchlist/watchlist-store.js';

const RELIANCE = instrumentId('RELIANCE');
const TCS = instrumentId('TCS');
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

  const events = createEventStore(db, sequentialIds(), clock);
  const snapshots = createSnapshotStore(db, clock);
  const watchlist = createWatchlistStore(db, clock);

  // RELIANCE moves and comes back. TCS never crosses the threshold.
  events.append(observeTicks(ticks(RELIANCE, [100, 96, 91, 95, 100])).events);
  snapshots.record(RELIANCE, rupees(100), START + 4 * 60_000);
  snapshots.record(TCS, rupees(3805), START + 3 * 60_000);
  watchlist.add(userId('alice'), RELIANCE);
  watchlist.add(userId('alice'), TCS);
});

afterEach(() => {
  db.close();
});

async function watchlistFor(user: string): Promise<WatchlistResponse> {
  const response = await request(app).get('/api/watchlist').query({ userId: user });
  expect(response.status).toBe(200);
  return response.body as WatchlistResponse;
}

describe('W1/W2: the watchlist shows everything the user follows', () => {
  it('includes the quiet instrument the attention feed correctly omits', async () => {
    const body = await watchlistFor('alice');
    expect(body.rows.map((r) => r.instrumentId)).toEqual(['RELIANCE', 'TCS']);

    const feed = await request(app).get('/api/attention-feed').query({ userId: 'alice' });
    const feedInstruments: string[] = (
      feed.body as { events: { instrumentId: string }[] }
    ).events.map((e) => e.instrumentId);
    // The two lists are different on purpose. Both are correct.
    expect(feedInstruments).not.toContain('TCS');
  });

  it('carries a latest recorded price and observation time for the quiet one', async () => {
    const tcs = (await watchlistFor('alice')).rows.find((r) => r.instrumentId === 'TCS');
    expect(tcs?.latestPrice).toBe(380_500);
    expect(tcs?.observedAt).toBe(START + 3 * 60_000);
    expect(tcs?.attention).toBe('quiet');
  });

  it('reports an instrument we follow but have never observed', async () => {
    await request(app)
      .post('/api/watchlist')
      .send({ userId: 'alice', instrumentId: 'WIPRO' })
      .expect(201);

    const wipro = (await watchlistFor('alice')).rows.find((r) => r.instrumentId === 'WIPRO');
    expect(wipro?.latestPrice).toBeUndefined();
    expect(wipro?.observedAt).toBeUndefined();
    expect(wipro?.attention).toBe('quiet');
  });
});

describe('W3: attention is derived on read', () => {
  it('flips to quiet after acknowledging, with nothing written to the watchlist', async () => {
    const before = await watchlistFor('alice');
    expect(before.rows.find((r) => r.instrumentId === 'RELIANCE')?.attention).toBe('changed');
    expect(before.rows.find((r) => r.instrumentId === 'RELIANCE')?.meaningfulChanges).toBe(2);

    await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'alice', throughSequence: 2 })
      .expect(200);

    const after = await watchlistFor('alice');
    const reliance = after.rows.find((r) => r.instrumentId === 'RELIANCE');
    expect(reliance?.attention).toBe('quiet');
    expect(reliance?.meaningfulChanges).toBe(0);
    // The row is still there; only the derived attention changed.
    expect(after.rows).toHaveLength(2);
  });

  it('distinguishes a round trip from nothing happening', async () => {
    const rows = (await watchlistFor('alice')).rows;
    const reliance = rows.find((r) => r.instrumentId === 'RELIANCE');
    const tcs = rows.find((r) => r.instrumentId === 'TCS');

    // Both are at a price equal to where they were. Only one has a story.
    expect(reliance?.netChangeBps).toBe(0);
    expect(reliance?.meaningfulChanges).toBe(2);
    expect(tcs?.netChangeBps).toBeUndefined();
    expect(tcs?.meaningfulChanges).toBe(0);
  });

  it('gives two users different attention over the same watchlist contents', async () => {
    const watchlist = createWatchlistStore(db, clock);
    watchlist.add(userId('bob'), RELIANCE);
    await request(app)
      .post('/api/attention-feed/ack')
      .send({ userId: 'bob', throughSequence: 2 })
      .expect(200);

    expect((await watchlistFor('alice')).rows[0]?.attention).toBe('changed');
    expect((await watchlistFor('bob')).rows[0]?.attention).toBe('quiet');
  });

  it('reading the watchlist never advances the watermark', async () => {
    await watchlistFor('alice');
    await watchlistFor('alice');
    const count = db.prepare('SELECT COUNT(*) AS n FROM user_read_watermarks').get();
    expect(count).toEqual({ n: 0 });
  });
});

describe('managing the watchlist', () => {
  it('adds an instrument', async () => {
    const response = await request(app)
      .post('/api/watchlist')
      .send({ userId: 'alice', instrumentId: 'WIPRO' })
      .expect(201);
    expect((response.body as WatchlistResponse).rows.map((r) => r.instrumentId)).toContain('WIPRO');
  });

  it('treats adding twice as a no-op rather than an error', async () => {
    await request(app).post('/api/watchlist').send({ userId: 'alice', instrumentId: 'WIPRO' });
    await request(app).post('/api/watchlist').send({ userId: 'alice', instrumentId: 'WIPRO' });
    const rows = (await watchlistFor('alice')).rows.filter((r) => r.instrumentId === 'WIPRO');
    expect(rows).toHaveLength(1);
  });

  it('removes an instrument', async () => {
    await request(app).delete('/api/watchlist/TCS').query({ userId: 'alice' }).expect(200);
    expect((await watchlistFor('alice')).rows.map((r) => r.instrumentId)).toEqual(['RELIANCE']);
  });

  it('keeps one user’s watchlist out of another’s', async () => {
    await request(app).post('/api/watchlist').send({ userId: 'bob', instrumentId: 'WIPRO' });
    expect((await watchlistFor('bob')).rows.map((r) => r.instrumentId)).toEqual(['WIPRO']);
    expect((await watchlistFor('alice')).rows.map((r) => r.instrumentId)).toEqual([
      'RELIANCE',
      'TCS',
    ]);
  });

  it('rejects malformed requests', async () => {
    await request(app).get('/api/watchlist').expect(400);
    await request(app).post('/api/watchlist').send({ userId: 'alice' }).expect(400);
    await request(app).post('/api/watchlist').send({ instrumentId: 'X' }).expect(400);
    await request(app).delete('/api/watchlist/TCS').expect(400);
  });
});

describe('W4: removing an instrument does not delete market history', () => {
  it('leaves every event row intact', async () => {
    const before = db.prepare('SELECT * FROM market_events ORDER BY sequence').all();

    await request(app).delete('/api/watchlist/RELIANCE').query({ userId: 'alice' }).expect(200);

    expect(db.prepare('SELECT * FROM market_events ORDER BY sequence').all()).toEqual(before);
  });

  it('still tells the story if the instrument is followed again', async () => {
    await request(app).delete('/api/watchlist/RELIANCE').query({ userId: 'alice' });
    await request(app).post('/api/watchlist').send({ userId: 'alice', instrumentId: 'RELIANCE' });

    const reliance = (await watchlistFor('alice')).rows.find((r) => r.instrumentId === 'RELIANCE');
    expect(reliance?.meaningfulChanges).toBe(2);

    // And the replay is untouched: history is not the user's to delete.
    const replay = await request(app).get('/api/replay').query({ instrumentId: 'RELIANCE' });
    expect((replay.body as { timeline: unknown[] }).timeline).toHaveLength(2);
  });

  it('leaves the snapshot intact too', async () => {
    await request(app).delete('/api/watchlist/TCS').query({ userId: 'alice' });
    const row = db.prepare('SELECT COUNT(*) AS n FROM instrument_snapshots').get();
    expect(row).toEqual({ n: 2 });
  });
});

describe('W5: the watchlist survives a restart', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'market-pulse-watchlist-'));
    dbPath = join(dir, 'test.sqlite');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('recovers entries and snapshots written by a different OS process', () => {
    const fixture = fileURLToPath(new URL('./fixtures/write-watchlist.ts', import.meta.url));
    const output = execFileSync(process.execPath, ['--import', 'tsx', fixture, dbPath], {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('../', import.meta.url)),
    });
    expect(JSON.parse(output)).toEqual({ entries: 2, head: 2 });

    const restarted = openDatabase(dbPath);
    try {
      migrate(restarted);
      const watchlist = createWatchlistStore(restarted, clock);
      const snapshots = createSnapshotStore(restarted, clock);

      expect(watchlist.list(userId('alice')).map((e) => e.instrumentId)).toEqual([
        'RELIANCE',
        'TCS',
      ]);
      // Including the quiet instrument, which has a snapshot but no events.
      expect(snapshots.list().map((s) => s.instrumentId)).toEqual(['RELIANCE', 'TCS']);
    } finally {
      restarted.close();
    }
  });
});

describe('snapshots record knowledge, not history', () => {
  it('overwrites with a newer observation', () => {
    const snapshots = createSnapshotStore(db, clock);
    snapshots.record(TCS, rupees(3900), START + 10 * 60_000);
    const tcs = snapshots.list().find((s) => s.instrumentId === TCS);
    expect(tcs?.latestPrice).toBe(rupees(3900));
  });

  it('refuses to go backwards in observation time', () => {
    const snapshots = createSnapshotStore(db, clock);
    snapshots.record(TCS, rupees(3900), START + 10 * 60_000);
    // A late-arriving reading of an older moment must not overwrite a newer one.
    snapshots.record(TCS, rupees(1), START);
    const tcs = snapshots.list().find((s) => s.instrumentId === TCS);
    expect(tcs?.latestPrice).toBe(rupees(3900));
    expect(tcs?.observedAt).toBe(START + 10 * 60_000);
  });
});

describe('W6: the benchmark is not something a watchlist can follow', () => {
  it('refuses to add the benchmark, and writes nothing', async () => {
    const before = await watchlistFor('alice');

    const response = await request(app)
      .post('/api/watchlist')
      .send({ userId: 'alice', instrumentId: 'NIFTY' })
      .expect(400);

    expect(String(response.body.error)).toContain('benchmark');

    // The rejection is not merely a status code: nothing was written.
    const after = await watchlistFor('alice');
    expect(after.rows.map((r) => r.instrumentId)).toEqual(before.rows.map((r) => r.instrumentId));
    expect(after.rows.some((r) => r.instrumentId === 'NIFTY')).toBe(false);

    const stored = createWatchlistStore(db, clock).list(userId('alice'));
    expect(stored.some((entry) => entry.instrumentId === 'NIFTY')).toBe(false);
  });

  it('applies the same trimming the store would, so padding does not slip past', async () => {
    // `instrumentId()` trims, so "  NIFTY  " is the benchmark by the time
    // anything is written. The check runs against the normalized value, not
    // the raw string.
    await request(app)
      .post('/api/watchlist')
      .send({ userId: 'alice', instrumentId: '  NIFTY  ' })
      .expect(400);

    const stored = createWatchlistStore(db, clock).list(userId('alice'));
    expect(stored.some((entry) => entry.instrumentId.trim() === 'NIFTY')).toBe(false);
  });

  it('leaves market history completely untouched when an add is refused', () => {
    const before = db.prepare('SELECT * FROM market_events ORDER BY sequence').all();
    return request(app)
      .post('/api/watchlist')
      .send({ userId: 'alice', instrumentId: 'NIFTY' })
      .expect(400)
      .then(() => {
        expect(db.prepare('SELECT * FROM market_events ORDER BY sequence').all()).toEqual(before);
      });
  });

  it('still lets every ordinary instrument be added', async () => {
    await request(app)
      .post('/api/watchlist')
      .send({ userId: 'alice', instrumentId: 'INFY' })
      .expect(201);

    const after = await watchlistFor('alice');
    expect(after.rows.some((r) => r.instrumentId === 'INFY')).toBe(true);
  });

  it.each(['NIFTY', 'nifty', 'Nifty', 'NiFtY', '  nifty  '])(
    'refuses %s, so case is not a one-keystroke bypass of the boundary',
    async (symbol) => {
      const before = createWatchlistStore(db, clock).list(userId('alice'));

      await request(app)
        .post('/api/watchlist')
        .send({ userId: 'alice', instrumentId: symbol })
        .expect(400);

      const after = createWatchlistStore(db, clock).list(userId('alice'));
      expect(after.map((e) => e.instrumentId)).toEqual(before.map((e) => e.instrumentId));
    },
  );

  it('does not fold case for ordinary instruments, which are stored as given', async () => {
    // The guard folds case; storage does not. Only the boundary widened --
    // an ordinary symbol is still keyed by the exact string it arrived as.
    await request(app)
      .post('/api/watchlist')
      .send({ userId: 'alice', instrumentId: 'wipro' })
      .expect(201);

    const stored = createWatchlistStore(db, clock).list(userId('alice'));
    expect(stored.some((e) => e.instrumentId === 'wipro')).toBe(true);
    expect(stored.some((e) => e.instrumentId === 'WIPRO')).toBe(false);
  });
});
