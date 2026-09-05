import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { createSimulator, type Simulator } from './modules/market/simulator.js';
import { readAppVersion } from './version.js';

const config = loadConfig();

const db = openDatabase(config.databaseUrl);
const applied = migrate(db);
if (applied.length > 0) {
  console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
}

/**
 * The only place a background timer is allowed to come from.
 *
 * `createApp` builds the generator but never starts it, so nothing that merely
 * constructs an app -- every test in the suite -- ends up with a market running
 * underneath it.
 */
let simulator: Simulator | undefined;
const app = createApp({
  db,
  version: readAppVersion(),
  ...(config.simulation.enabled
    ? {
        createSimulation: (deps) => {
          simulator = createSimulator({ ...deps, intervalMs: config.simulation.intervalMs });
          return simulator;
        },
      }
    : {}),
});

simulator?.start();

const server = app.listen(config.port, () => {
  console.log(`Market Pulse API listening on http://localhost:${config.port} (${config.nodeEnv})`);
  const status = simulator?.status();
  if (status === undefined) {
    console.log('Market simulation is off. Prices are whatever the seed recorded.');
  } else if (status.instruments === 0) {
    // "Simulating 0 instrument(s) every 3000ms" was technically true and read
    // as a working system. This is the state a fresh clone boots into.
    console.log('Market simulation is on, but there is nothing to simulate yet.');
    console.log('Run `npm run db:seed` to build the demo market, then restart.');
  } else {
    console.log(
      `Simulating ${status.instruments} instrument(s) every ${config.simulation.intervalMs}ms. ` +
        'Prices are generated, not real; every one of them goes through the same significance rule.',
    );
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    simulator?.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
