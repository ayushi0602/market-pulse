import { loadConfig } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = openDatabase(config.databaseUrl);

try {
  const applied = migrate(db);
  console.log(
    applied.length === 0
      ? `No pending migrations (${config.databaseUrl}).`
      : `Applied ${applied.length} migration(s): ${applied.join(', ')}`,
  );
} finally {
  db.close();
}
