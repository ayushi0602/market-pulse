import { instrumentId, observeTicks, rupees } from '@market-pulse/domain';
import type { MarketTick } from '@market-pulse/domain';
import { loadConfig } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import { createEventStore } from '../modules/market/event-store.js';
import { uuidEventIds } from '../ids.js';
import { systemClock } from '@market-pulse/domain';

/**
 * Demo data: the golden scenario, plus two contrasting instruments.
 *
 * Not fixtures for tests -- tests build their own. This exists so `npm run dev`
 * shows something, and so the comparison the product rests on can be seen
 * rather than described.
 */
const HOUR = 3_600_000;
const openedAt = Date.now() - 6 * HOUR;

function stream(symbol: string, prices: number[]): MarketTick[] {
  const id = instrumentId(symbol);
  return prices.map((price, index) => ({
    instrumentId: id,
    price: rupees(price),
    at: openedAt + index * (HOUR / 2),
  }));
}

const streams = [
  // The golden scenario. Ends exactly where it started.
  stream('RELIANCE', [2900, 2840, 2639, 2750, 2900]),
  // A plain decline: a snapshot view would also catch this one.
  stream('INFY', [1500, 1470, 1200]),
  // Quiet. Never crosses the threshold, so it produces no events at all.
  stream('TCS', [3800, 3810, 3795, 3805]),
];

const config = loadConfig();
const db = openDatabase(config.databaseUrl);
migrate(db);

const store = createEventStore(db, uuidEventIds, systemClock);
let written = 0;
for (const ticks of streams) {
  written += store.append(observeTicks(ticks).events).length;
}

console.log(
  `Seeded ${written} event(s) across ${streams.length} instruments (${config.databaseUrl}).`,
);
console.log(`Log head is now ${store.head()}. Open http://localhost:5173 as any user.`);
db.close();
