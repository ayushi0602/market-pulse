import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { readAppVersion } from './version.js';

const config = loadConfig();

const db = openDatabase(config.databaseUrl);
const applied = migrate(db);
if (applied.length > 0) {
  console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
}

const app = createApp({ db, version: readAppVersion() });

const server = app.listen(config.port, () => {
  console.log(`Market Pulse API listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
