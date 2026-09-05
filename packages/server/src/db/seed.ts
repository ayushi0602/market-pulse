import { instrumentId, observeTicks, rupees, systemClock, userId } from '@market-pulse/domain';
import type { MarketTick } from '@market-pulse/domain';
import { loadConfig } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import { createEventStore } from '../modules/market/event-store.js';
import { createSnapshotStore } from '../modules/market/snapshot-store.js';
import { createWatchlistStore } from '../modules/watchlist/watchlist-store.js';
import { createWatermarkStore } from '../modules/attention/watermark-store.js';
import { BENCHMARK_SYMBOL, CATALOGUE } from '../modules/market/catalogue.js';
import { uuidEventIds } from '../ids.js';

/**
 * The morning that happened before you opened the app.
 *
 * Not fixtures for tests -- tests build their own. This exists so `npm run dev`
 * shows a market with enough going on to be worth reading, and so the
 * comparison the product rests on can be seen rather than described. The prices
 * come from CATALOGUE, which the simulator then continues from.
 *
 * Every event below is produced by running the catalogue's prices through the
 * ordinary significance engine. Nothing is written into the log by hand, so the
 * seeded history obeys exactly the rule a live one would.
 */
const HALF_HOUR = 1_800_000;

function stream(symbol: string, prices: readonly number[], openedAt: number): MarketTick[] {
  const id = instrumentId(symbol);
  return prices.map((price, index) => ({
    instrumentId: id,
    price: rupees(price),
    at: openedAt + index * HALF_HOUR,
  }));
}

const config = loadConfig();
const db = openDatabase(config.databaseUrl);
migrate(db);

const store = createEventStore(db, uuidEventIds, systemClock);
const snapshots = createSnapshotStore(db, systemClock);
const watermarks = createWatermarkStore(db, systemClock);

/**
 * Watchlist order is `added_at`, and twelve instruments added inside the same
 * millisecond would fall back to alphabetical -- burying RELIANCE, which is the
 * instrument the whole demo turns on. A clock that advances one millisecond per
 * call keeps the seeded order the order the catalogue lists.
 */
let addedAt = Date.now();
const orderedClock = { now: () => (addedAt += 1) };
const watchlist = createWatchlistStore(db, orderedClock);

const demo = userId('demo');
/**
 * A second reader, seeded mid-log.
 *
 * The claim that two people opening the app at the same instant see different
 * things is the centre of the design, and it should be demonstrable in the
 * running app rather than only in a test. `priya` has already read the first
 * two thirds of history; `demo` has read none of it. Same log, same moment,
 * different answers.
 */
const priya = userId('priya');

/**
 * Refuse to seed a database that already has history.
 *
 * The event log is append-only, so a second run cannot replace the first -- it
 * appends a duplicate story, and every instrument then reports twice the
 * changes it should. There is no "re-seed" that preserves the point, which is
 * why this exits rather than trying to be clever. `npm run db:reset` starts
 * over from an empty file.
 */
if (store.head() > 0) {
  console.error(`Refusing to seed: ${config.databaseUrl} already holds ${store.head()} event(s).`);
  console.error('History is append-only, so seeding again would duplicate the story.');
  console.error('Run `npm run db:reset` to start from an empty database.');
  db.close();
  process.exit(1);
}

// Half an hour per tick, ending just before now: the longest story in the
// catalogue sets how far back the market opened.
const longest = Math.max(...CATALOGUE.map((entry) => entry.openingPath.length));
const openedAt = Date.now() - longest * HALF_HOUR;

let written = 0;
for (const entry of CATALOGUE) {
  const ticks = stream(entry.symbol, entry.openingPath, openedAt);
  const { events } = observeTicks(ticks);
  written += store.append(events).length;

  // The latest observation, taken from the last tick of the stream. In a system
  // with real ingestion this is what the ingester would write; here it is the
  // seed and then the simulator, because there is no market data feed and
  // pretending otherwise would be the kind of overclaim this project keeps
  // refusing to make.
  const last = ticks[ticks.length - 1];
  const first = ticks[0];
  if (last !== undefined && first !== undefined) {
    snapshots.record(first.instrumentId, last.price, last.at);
    // The benchmark is market context, not something either reader chose to
    // follow -- it is tracked and simulated like every other instrument, but
    // it does not go on a watchlist, because nobody asked to watch it.
    if (entry.symbol !== BENCHMARK_SYMBOL) {
      watchlist.add(demo, first.instrumentId);
      watchlist.add(priya, first.instrumentId);
    }
  }

  console.log(
    `  ${entry.symbol.padEnd(11)} ${String(events.length).padStart(2)} event(s)  — ${entry.note}`,
  );
}

// Two thirds of the way through, rounded down: enough behind for her feed to be
// visibly shorter, enough read for the difference to be obvious.
const priyaHasRead = Math.floor((store.head() * 2) / 3);
watermarks.advanceTo(priya, priyaHasRead);

console.log('');
console.log(`Seeded ${written} event(s) across ${CATALOGUE.length} instruments.`);
console.log(`  ${config.databaseUrl}`);
console.log('');
console.log(`  demo  — has read nothing. Sees all ${store.head()} events.`);
console.log(`  priya — has read through ${priyaHasRead}. Sees ${store.head() - priyaHasRead}.`);
console.log('');
console.log('Same log, same moment, different answers. Switch users in the app to see it.');
db.close();
