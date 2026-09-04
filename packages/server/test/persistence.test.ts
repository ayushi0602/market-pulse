import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  toPercent,
  toRupees,
  unreadFor,
  userId,
} from '@market-pulse/domain';
import type { MarketTick } from '@market-pulse/domain';
import { openDatabase, type Database } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createEventStore } from '../src/modules/market/event-store.js';
import { createWatermarkStore } from '../src/modules/attention/watermark-store.js';

const RELIANCE = instrumentId('RELIANCE');
const INFY = instrumentId('INFY');
const START = 1_700_000_000_000;
const MINUTE = 60_000;
const clock = { now: () => START };

function goldenTicks(): MarketTick[] {
  return [100, 96, 91, 95, 100].map((price, index) => ({
    instrumentId: RELIANCE,
    price: rupees(price),
    at: START + index * MINUTE,
  }));
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Expected ${what} to be present`);
  return value;
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-pulse-test-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function open(): Database {
  const db = openDatabase(dbPath);
  migrate(db);
  return db;
}

describe('AC1: the golden scenario survives a restart', () => {
  it('recovers the events exactly, written by a different OS process', () => {
    // Process A: a real child process. It shares no memory with this one, so
    // anything that comes back came out of the database.
    const fixture = fileURLToPath(new URL('./fixtures/write-golden-scenario.ts', import.meta.url));
    const output = execFileSync(process.execPath, ['--import', 'tsx', fixture, dbPath], {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('../', import.meta.url)),
    });
    expect(JSON.parse(output)).toEqual({ written: 2, head: 2 });

    // Process B: this one. Opens the same file and asks what it missed.
    const db = open();
    try {
      const events = createEventStore(db, sequentialIds(), clock);
      const missed = events.readAfter(0);

      expect(missed).toHaveLength(2);

      const decline = required(
        missed.find((record) => record.event.direction === 'decline'),
        'the decline',
      ).event;
      expect(toRupees(decline.fromPrice)).toBe(100);
      expect(toRupees(decline.toPrice)).toBe(91);
      expect(toPercent(decline.magnitudeBps)).toBe(9);
      expect(decline.occurredAt).toBe(START + 2 * MINUTE);

      // The product claim, now across a process boundary: the price ended where
      // it started, and the history still says what happened.
      const advance = required(missed[1], 'the recovery').event;
      expect(advance.toPrice).toBe(rupees(100));
      expect(missed).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('preserves per-user position across the restart', () => {
    const fixture = fileURLToPath(new URL('./fixtures/write-golden-scenario.ts', import.meta.url));
    execFileSync(process.execPath, ['--import', 'tsx', fixture, dbPath], {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('../', import.meta.url)),
    });

    const db = open();
    try {
      const events = createEventStore(db, sequentialIds(), clock);
      const watermarks = createWatermarkStore(db, clock);
      const log = { records: events.readAfter(0), head: events.head() };

      // Bob acknowledged everything in the other process; Alice never did.
      expect(unreadFor(watermarks.get(userId('bob')), log)).toHaveLength(0);
      expect(unreadFor(watermarks.get(userId('alice')), log)).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe('AC2: sequence does not reset across a restart', () => {
  it('continues numbering where the previous process stopped', () => {
    const first = open();
    const ids = sequentialIds('a');
    createEventStore(first, ids, clock).append(observeTicks(goldenTicks()).events);
    first.close();

    const second = open();
    try {
      const store = createEventStore(second, sequentialIds('b'), clock);
      expect(store.head()).toBe(2);

      const more = store.append(observeTicks(goldenTicks()).events);
      expect(more.map((r) => r.sequence)).toEqual([3, 4]);
    } finally {
      second.close();
    }
  });

  it('does not reuse a sequence number even conceptually', () => {
    const db = open();
    try {
      const store = createEventStore(db, sequentialIds(), clock);
      store.append(observeTicks(goldenTicks()).events);
      // AUTOINCREMENT: the high-water mark is remembered, not recomputed from
      // MAX(sequence). A watermark at 2 can never come to mean a later event.
      const row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'market_events'").get();
      expect(row).toEqual({ seq: 2 });
    } finally {
      db.close();
    }
  });
});

describe('AC3: append-only survives persistence', () => {
  it('offers no way to update or delete an event', () => {
    const db = open();
    try {
      const store = createEventStore(db, sequentialIds(), clock);
      expect(Object.keys(store).sort()).toEqual(['append', 'head', 'readAfter']);
    } finally {
      db.close();
    }
  });

  it('refuses an UPDATE at the database level, not just in the API', () => {
    const db = open();
    try {
      createEventStore(db, sequentialIds(), clock).append(observeTicks(goldenTicks()).events);
      expect(() => db.exec('UPDATE market_events SET to_price = 1 WHERE sequence = 1')).toThrow(
        /append-only/,
      );
    } finally {
      db.close();
    }
  });

  it('refuses a DELETE at the database level', () => {
    const db = open();
    try {
      createEventStore(db, sequentialIds(), clock).append(observeTicks(goldenTicks()).events);
      expect(() => db.exec('DELETE FROM market_events WHERE sequence = 1')).toThrow(/append-only/);
    } finally {
      db.close();
    }
  });

  it('rejects a duplicate event id rather than silently double-recording', () => {
    const db = open();
    try {
      const fixed = { next: () => 'the-same-id' as never };
      const store = createEventStore(db, fixed, clock);
      const [event] = observeTicks(goldenTicks()).events;
      store.append([required(event, 'an event')]);
      expect(() => store.append([required(event, 'an event')])).toThrow();
      expect(store.head()).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe('AC4: watermarks are independent and stored once per user', () => {
  it('keeps two users at different positions over one shared log', () => {
    const db = open();
    try {
      const events = createEventStore(db, sequentialIds(), clock);
      const watermarks = createWatermarkStore(db, clock);
      events.append(observeTicks(goldenTicks()).events);
      events.append(observeTicks(goldenTicks()).events);

      watermarks.advanceTo(userId('alice'), 4);
      watermarks.advanceTo(userId('bob'), 2);

      expect(watermarks.get(userId('alice')).lastSeenSequence).toBe(4);
      expect(watermarks.get(userId('bob')).lastSeenSequence).toBe(2);
      expect(events.readAfter(watermarks.get(userId('bob')).lastSeenSequence)).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('stores each event once, not once per user', () => {
    const db = open();
    try {
      const events = createEventStore(db, sequentialIds(), clock);
      const watermarks = createWatermarkStore(db, clock);
      events.append(observeTicks(goldenTicks()).events);

      for (const name of ['alice', 'bob', 'carol', 'dave']) {
        watermarks.advanceTo(userId(name), 1);
      }

      // Four readers, two events. Fan-out on write would give eight rows.
      const count = db.prepare('SELECT COUNT(*) AS n FROM market_events').get();
      expect(count).toEqual({ n: 2 });
      const readers = db.prepare('SELECT COUNT(*) AS n FROM user_read_watermarks').get();
      expect(readers).toEqual({ n: 4 });
    } finally {
      db.close();
    }
  });

  it('treats an unknown user as having read nothing, without creating a row', () => {
    const db = open();
    try {
      const watermarks = createWatermarkStore(db, clock);
      expect(watermarks.get(userId('nobody')).lastSeenSequence).toBe(0);
      const count = db.prepare('SELECT COUNT(*) AS n FROM user_read_watermarks').get();
      expect(count).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});

describe('AC5: a watermark never moves backwards', () => {
  it('ignores a stale position arriving after a newer one', () => {
    const db = open();
    try {
      const watermarks = createWatermarkStore(db, clock);
      watermarks.advanceTo(userId('alice'), 20);

      // The multi-device case: an old tab reports position 15 after the phone
      // already reported 20. The user has seen 20; they must not be shown 16-20
      // again.
      const result = watermarks.advanceTo(userId('alice'), 15);
      expect(result.lastSeenSequence).toBe(20);
      expect(watermarks.get(userId('alice')).lastSeenSequence).toBe(20);
    } finally {
      db.close();
    }
  });

  it('holds under interleaved out-of-order writes', () => {
    const db = open();
    try {
      const watermarks = createWatermarkStore(db, clock);
      for (const sequence of [5, 3, 9, 1, 7, 2]) {
        watermarks.advanceTo(userId('alice'), sequence);
      }
      expect(watermarks.get(userId('alice')).lastSeenSequence).toBe(9);
    } finally {
      db.close();
    }
  });

  it('rejects a negative or fractional position outright', () => {
    const db = open();
    try {
      const watermarks = createWatermarkStore(db, clock);
      expect(() => watermarks.advanceTo(userId('alice'), -1)).toThrow(/non-negative/);
      expect(() => watermarks.advanceTo(userId('alice'), 1.5)).toThrow(/non-negative/);
    } finally {
      db.close();
    }
  });
});

describe('reads are scoped and ordered', () => {
  it('filters by instrument without disturbing global ordering', () => {
    const db = open();
    try {
      const store = createEventStore(db, sequentialIds(), clock);
      store.append(observeTicks(goldenTicks()).events);
      store.append(
        observeTicks(
          [100, 80].map((price, index) => ({
            instrumentId: INFY,
            price: rupees(price),
            at: START + index * MINUTE,
          })),
        ).events,
      );

      expect(store.readAfter(0)).toHaveLength(3);
      expect(store.readAfter(0, INFY).map((r) => r.sequence)).toEqual([3]);
      expect(store.readAfter(0, RELIANCE).map((r) => r.sequence)).toEqual([1, 2]);
    } finally {
      db.close();
    }
  });

  it('round-trips a stored event identically to the one the engine produced', () => {
    const db = open();
    try {
      const store = createEventStore(db, sequentialIds(), clock);
      const { events } = observeTicks(goldenTicks());
      const written = store.append(events);
      const read = store.readAfter(0);
      expect(read.map((r) => r.event)).toEqual([...events]);
      expect(read.map((r) => r.eventId)).toEqual(written.map((r) => r.eventId));
    } finally {
      db.close();
    }
  });
});
