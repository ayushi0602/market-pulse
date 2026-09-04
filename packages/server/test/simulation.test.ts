import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  instrumentId,
  observeTicks,
  rupees,
  sequentialIds,
  userId,
  type MarketTick,
} from '@market-pulse/domain';
import { openDatabase, type Database } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { createEventStore } from '../src/modules/market/event-store.js';
import { createSnapshotStore } from '../src/modules/market/snapshot-store.js';
import { createWatermarkStore } from '../src/modules/attention/watermark-store.js';
import { createSimulator, seededRandom } from '../src/modules/market/simulator.js';
import { CATALOGUE } from '../src/modules/market/catalogue.js';

/**
 * The generated market.
 *
 * The thing worth testing is not that it produces plausible prices -- it
 * produces invented ones and says so. It is that inventing prices does not
 * become a second way into history. Everything below asks the same question:
 * does a simulated price get any privilege a seeded one does not?
 */

const START = 1_700_000_000_000;

/**
 * One id source for the whole file.
 *
 * `sequentialIds` restarts its counter on every call, so a per-store source
 * hands out the same id twice as soon as one test seeds two instruments -- and
 * the unique index on event_id catches it, correctly.
 */
const ids = sequentialIds('test');

/**
 * A clock that advances a minute per read, starting an hour after the seeded
 * stories end -- so a generated tick is never mistaken for one from the past.
 */
function advancingClock(from = START + 3_600_000) {
  let at = from;
  return { now: () => (at += 60_000) };
}

function seedInstrument(
  db: Database,
  symbol: string,
  prices: readonly number[],
): { instrument: ReturnType<typeof instrumentId> } {
  const instrument = instrumentId(symbol);
  const events = createEventStore(db, ids, { now: () => START });
  const snapshots = createSnapshotStore(db, { now: () => START });
  const ticks: MarketTick[] = prices.map((price, index) => ({
    instrumentId: instrument,
    price: rupees(price),
    at: START + index * 60_000,
  }));
  events.append(observeTicks(ticks).events);
  const last = ticks[ticks.length - 1];
  if (last !== undefined) snapshots.record(instrument, last.price, last.at);
  return { instrument };
}

function stores(db: Database, clock = advancingClock()) {
  return {
    events: createEventStore(db, ids, clock),
    snapshots: createSnapshotStore(db, clock),
    clock,
  };
}

let db: Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
});

describe('a generated price is still just a price', () => {
  it('records an event only when the published threshold is crossed', () => {
    seedInstrument(db, 'RELIANCE', [2900]);
    const { events, snapshots, clock } = stores(db);
    const before = events.head();

    // A generator that never moves the price cannot produce an event, whatever
    // it is called or however often it runs.
    const still = createSimulator({
      events,
      snapshots,
      clock,
      intervalMs: 1000,
      random: () => 0.5,
    });
    for (let i = 0; i < 50; i += 1) still.step();

    expect(events.head()).toBe(before);
  });

  it('produces events whose magnitude matches the move that was actually made', () => {
    seedInstrument(db, 'ADANIENT', [3200]);
    const { events, snapshots, clock } = stores(db);
    const before = events.head();

    const sim = createSimulator({
      events,
      snapshots,
      clock,
      intervalMs: 1000,
      random: seededRandom(7),
    });
    for (let i = 0; i < 2000; i += 1) sim.step();

    const produced = events.readAfter(before);
    expect(produced.length).toBeGreaterThan(0);
    for (const record of produced) {
      // Every one of them clears the threshold, and its magnitude is the move
      // from its own anchor to its own price -- recomputed here rather than
      // taken on trust from the field beside it.
      expect(record.event.magnitudeBps).toBeGreaterThanOrEqual(500);
      const recomputed = Math.round(
        ((record.event.toPrice - record.event.fromPrice) * 10_000) / record.event.fromPrice,
      );
      expect(Math.abs(recomputed)).toBe(record.event.magnitudeBps);
      expect(record.event.direction).toBe(recomputed < 0 ? 'decline' : 'advance');
    }
  });

  it('is reproducible: the same seed writes the same history twice', () => {
    const run = () => {
      const fresh = openDatabase(':memory:');
      migrate(fresh);
      seedInstrument(fresh, 'ZOMATO', [260]);
      const { events, snapshots, clock } = stores(fresh);
      const sim = createSimulator({
        events,
        snapshots,
        clock,
        intervalMs: 1000,
        random: seededRandom(99),
      });
      // Crossings are rare by design, so this runs long enough to get several.
      for (let i = 0; i < 2000; i += 1) sim.step();
      return events.readAfter(0).map((r) => `${r.event.direction}:${r.event.magnitudeBps}`);
    };

    const first = run();
    const second = run();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});

describe('the quiet instruments stay quiet while the market runs', () => {
  it('never crosses the threshold for a calm instrument', () => {
    // The demo rests on TCS being followed and silent. If a running market
    // could make it noisy, the screen that explains "quiet is not the same as
    // nothing" would stop being reliably demonstrable.
    seedInstrument(db, 'TCS', [3805]);
    const { events, snapshots, clock } = stores(db);
    const sim = createSimulator({
      events,
      snapshots,
      clock,
      intervalMs: 1000,
      random: seededRandom(4242),
    });
    for (let i = 0; i < 2000; i += 1) sim.step();

    expect(events.readAfter(0)).toHaveLength(0);
  });
});

describe('I4: a running market cannot consume anyone unread events', () => {
  it('leaves every read position exactly where it was', () => {
    seedInstrument(db, 'ADANIENT', [3200]);
    const clock = advancingClock();
    const watermarks = createWatermarkStore(db, clock);
    const reader = userId('demo');
    watermarks.advanceTo(reader, 1);

    const { events, snapshots } = stores(db, clock);
    const sim = createSimulator({
      events,
      snapshots,
      clock,
      intervalMs: 1000,
      random: seededRandom(11),
    });
    for (let i = 0; i < 2000; i += 1) sim.step();

    // The generator was never given a watermark store, so this is a structural
    // guarantee rather than a policy: there is no call it could have made.
    expect(watermarks.get(reader).lastSeenSequence).toBe(1);
    expect(events.head()).toBeGreaterThan(1);
  });
});

describe('restarting the process does not re-arm the threshold from the wrong price', () => {
  it('resumes the anchor from the last recorded event, not the latest price', () => {
    /*
     * SBIN's slow slide ends at 562 with its last event having fired at 585.
     * Those two numbers are what make this test able to fail: the anchor is
     * 585, the latest price is 562, and they imply different trigger points.
     *
     *   anchor 585 (correct)  -> the next decline fires at or below 555.75
     *   anchor 562 (the bug)  -> it would not fire until 533.90
     *
     * So a price driven down to somewhere between the two produces one event
     * if the anchor was resumed properly and none if it was reset to the
     * latest price. The event's own `fromPrice` then names which one was used.
     */
    seedInstrument(db, 'SBIN', [620, 608, 596, 585, 573, 562]);
    const seeded = createEventStore(db, ids, { now: () => START }).readAfter(0);
    expect(seeded[seeded.length - 1]?.event.toPrice).toBe(58_500);

    const { events, snapshots, clock } = stores(db);
    const sim = createSimulator({
      events,
      snapshots,
      clock,
      intervalMs: 1000,
      // The bottom of the shock range every step: a steady, deterministic fall.
      random: () => 0,
    });
    sim.step();
    sim.step();
    sim.step();

    const produced = events.readAfter(seeded.length);
    expect(produced.length).toBeGreaterThan(0);
    expect(produced[0]?.event.fromPrice).toBe(58_500);
    expect(produced[0]?.event.direction).toBe('decline');
  });
});

describe('the API says where the prices come from', () => {
  let app: Express;

  beforeEach(() => {
    seedInstrument(db, 'RELIANCE', [2900, 2639]);
  });

  it('reports static data when nothing is generating prices', async () => {
    app = createApp({ db, version: '0.0.1', clock: { now: () => START } });
    const response = await request(app).get('/api/market-status').expect(200);

    expect(response.body).toMatchObject({ source: 'static', running: false, intervalMs: 0 });
    // The word must not appear even as a union member the client could render.
    expect(JSON.stringify(response.body)).not.toMatch(/live/i);
  });

  it('refuses to start a simulation that does not exist', async () => {
    app = createApp({ db, version: '0.0.1', clock: { now: () => START } });
    await request(app).post('/api/market-status').send({ running: true }).expect(409);
  });

  it('reports the simulation, and pauses and resumes it on request', async () => {
    app = createApp({
      db,
      version: '0.0.1',
      clock: advancingClock(),
      createSimulation: (deps) => createSimulator({ ...deps, intervalMs: 60_000 }),
    });

    const idle = await request(app).get('/api/market-status').expect(200);
    expect(idle.body).toMatchObject({ source: 'simulated', running: false, instruments: 1 });

    const started = await request(app)
      .post('/api/market-status')
      .send({ running: true })
      .expect(200);
    expect(started.body).toMatchObject({ running: true, intervalMs: 60_000 });

    const stopped = await request(app)
      .post('/api/market-status')
      .send({ running: false })
      .expect(200);
    expect(stopped.body).toMatchObject({ running: false });

    await request(app).post('/api/market-status').send({ running: 'yes' }).expect(400);
  });

  it('reports the log head, so a client can tell that history grew', async () => {
    app = createApp({ db, version: '0.0.1', clock: { now: () => START } });
    const response = await request(app).get('/api/market-status').expect(200);
    expect(response.body).toMatchObject({ sequence: 1 });
  });
});

describe('the replay catalogue lists stories, not watchlists', () => {
  it('offers only instruments that have recorded events, and needs no user', async () => {
    seedInstrument(db, 'RELIANCE', [2900, 2639, 2900]);
    seedInstrument(db, 'TCS', [3800, 3805]);
    const app = createApp({ db, version: '0.0.1', clock: { now: () => START } });

    const response = await request(app).get('/api/replay/instruments').expect(200);
    const symbols = (response.body as { instruments: { instrumentId: string }[] }).instruments.map(
      (entry) => entry.instrumentId,
    );

    // TCS is on every watchlist in the demo and has no story, which is exactly
    // the distinction this endpoint has to respect.
    expect(symbols).toEqual(['RELIANCE']);
  });

  it('leads with the biggest story', async () => {
    seedInstrument(db, 'RELIANCE', [2900, 2639, 2900]);
    seedInstrument(db, 'INFY', [1500, 1200]);
    const app = createApp({ db, version: '0.0.1', clock: { now: () => START } });

    const response = await request(app).get('/api/replay/instruments').expect(200);
    const instruments = (response.body as { instruments: { instrumentId: string }[] }).instruments;
    expect(instruments[0]?.instrumentId).toBe('INFY');
  });
});

describe('the catalogue and the significance rule agree', () => {
  it('gives the demo a quiet instrument and a round trip', () => {
    // A guard on the demo itself: if someone edits the price paths, this fails
    // rather than the reviewer discovering a watchlist where nothing is quiet.
    const stories = CATALOGUE.map((entry) => ({
      symbol: entry.symbol,
      events: observeTicks(
        entry.openingPath.map((price, index) => ({
          instrumentId: instrumentId(entry.symbol),
          price: rupees(price),
          at: START + index * 60_000,
        })),
      ).events,
    }));

    expect(stories.filter((s) => s.events.length === 0).length).toBeGreaterThan(0);

    const reliance = stories.find((s) => s.symbol === 'RELIANCE');
    expect(reliance?.events.map((e) => e.magnitudeBps)).toEqual([900, 989]);
    const path = CATALOGUE.find((e) => e.symbol === 'RELIANCE')?.openingPath ?? [];
    expect(path[0]).toBe(path[path.length - 1]);
  });
});
