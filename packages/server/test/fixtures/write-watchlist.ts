/**
 * Process A of the watchlist restart test: builds a watchlist, records
 * snapshots, and exits.
 */
import { instrumentId, observeTicks, rupees, systemClock, userId } from '@market-pulse/domain';
import type { MarketTick } from '@market-pulse/domain';
import { openDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { createEventStore } from '../../src/modules/market/event-store.js';
import { createSnapshotStore } from '../../src/modules/market/snapshot-store.js';
import { createWatchlistStore } from '../../src/modules/watchlist/watchlist-store.js';
import { uuidEventIds } from '../../src/ids.js';

const databasePath = process.argv[2];
if (databasePath === undefined) {
  throw new Error('Usage: write-watchlist.ts <database-path>');
}

const START = 1_700_000_000_000;
const streams: [string, number[]][] = [
  ['RELIANCE', [100, 96, 91, 95, 100]],
  ['TCS', [3800, 3810, 3795, 3805]],
];

const db = openDatabase(databasePath);
migrate(db);

const events = createEventStore(db, uuidEventIds, systemClock);
const snapshots = createSnapshotStore(db, systemClock);
const watchlist = createWatchlistStore(db, systemClock);
const alice = userId('alice');

for (const [symbol, prices] of streams) {
  const instrument = instrumentId(symbol);
  const ticks: MarketTick[] = prices.map((price, index) => ({
    instrumentId: instrument,
    price: rupees(price),
    at: START + index * 60_000,
  }));

  events.append(observeTicks(ticks).events);
  const last = ticks[ticks.length - 1];
  if (last !== undefined) {
    snapshots.record(instrument, last.price, last.at);
  }
  watchlist.add(alice, instrument);
}

process.stdout.write(
  JSON.stringify({ entries: watchlist.list(alice).length, head: events.head() }),
);
db.close();
