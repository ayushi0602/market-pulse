import { rmSync } from 'node:fs';
import { loadConfig } from '../config.js';

/**
 * Deletes the local database file so the demo can be seeded from scratch.
 *
 * Necessary because the event log is append-only: there is no way to remove
 * history through the application, by design. Starting over means starting from
 * an empty file, and saying so plainly is better than offering a "clear events"
 * command that would contradict the product's central guarantee.
 *
 * Refuses to touch an in-memory database or anything outside the configured
 * path.
 */
const config = loadConfig();

if (config.databaseUrl === ':memory:') {
  console.error('DATABASE_URL is :memory: — there is no file to reset.');
  process.exit(1);
}

for (const suffix of ['', '-journal', '-wal', '-shm']) {
  rmSync(`${config.databaseUrl}${suffix}`, { force: true });
}

console.log(`Removed ${config.databaseUrl}. Run \`npm run db:seed\` to rebuild the demo.`);
