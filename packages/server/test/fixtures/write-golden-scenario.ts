/**
 * Process A of the restart test.
 *
 * Run as a real, separate OS process: it observes the golden-scenario ticks,
 * writes the resulting events to the database given as argv[2], and exits. It
 * shares no memory with the test that reads them back.
 */
import { instrumentId, observeTicks, rupees, userId } from '@market-pulse/domain';
import type { MarketTick } from '@market-pulse/domain';
import { openDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { createEventStore } from '../../src/modules/market/event-store.js';
import { createWatermarkStore } from '../../src/modules/attention/watermark-store.js';
import { uuidEventIds } from '../../src/ids.js';

const databasePath = process.argv[2];
if (databasePath === undefined) {
  throw new Error('Usage: write-golden-scenario.ts <database-path>');
}

const RELIANCE = instrumentId('RELIANCE');
const START = 1_700_000_000_000;
const MINUTE = 60_000;

const ticks: MarketTick[] = [100, 96, 91, 95, 100].map((price, index) => ({
  instrumentId: RELIANCE,
  price: rupees(price),
  at: START + index * MINUTE,
}));

const db = openDatabase(databasePath);
migrate(db);

const clock = { now: () => START };
const events = createEventStore(db, uuidEventIds, clock);
const watermarks = createWatermarkStore(db, clock);

const written = events.append(observeTicks(ticks).events);

// Bob watched it happen; Alice was away and never acknowledges anything.
watermarks.advanceTo(userId('bob'), events.head());

process.stdout.write(JSON.stringify({ written: written.length, head: events.head() }));
db.close();
