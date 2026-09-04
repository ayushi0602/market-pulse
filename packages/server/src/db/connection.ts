import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The relational store.
 *
 * Step 1 uses SQLite via Node's built-in `node:sqlite` driver: a real relational
 * database with real SQL and real migrations, and no service to install or run.
 *
 * On portability: everything above this file speaks plain SQL rather than
 * SQLite-specific APIs, so the persistence layer can move to Postgres without
 * touching domain logic or route handlers. That is a bounded change, not a free
 * one -- the driver, the connection lifecycle (sync here, async there), and the
 * SQL dialect (upserts, timestamps, JSON, generated ids, concurrency semantics)
 * all need a deliberate pass. The boundary is what keeps that work confined to
 * this directory.
 */
export type Database = DatabaseSync;

export function openDatabase(databaseUrl: string): Database {
  if (databaseUrl !== ':memory:') {
    mkdirSync(dirname(databaseUrl), { recursive: true });
  }

  const db = new DatabaseSync(databaseUrl);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}
