import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { fixedClock } from '@market-pulse/domain';
import { openDatabase, type Database } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';

const NOW = 1_700_000_000_000;

describe('smoke: the stack boots end to end', () => {
  let db: Database;
  let app: Express;

  beforeAll(() => {
    db = openDatabase(':memory:');
    migrate(db);
    app = createApp({ db, clock: fixedClock(NOW), version: '0.0.1' });
  });

  afterAll(() => {
    db.close();
  });

  it('runs every migration on disk and records them', () => {
    // Compared against the directory rather than a hardcoded list: an
    // enumerated expectation has to be edited every time a migration is added,
    // which trains everyone to edit it without reading it. The invariant that
    // actually matters is "nothing on disk was skipped".
    const onDisk = readdirSync(fileURLToPath(new URL('../src/db/migrations', import.meta.url)))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    const applied = (
      db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]
    ).map((row) => row.name);

    expect(applied).toEqual(onDisk);
    expect(applied.length).toBeGreaterThan(0);
  });

  it('is idempotent when migrations run twice', () => {
    expect(migrate(db)).toEqual([]);
  });

  it('serves a healthy GET /api/health backed by the database', async () => {
    const response = await request(app).get('/api/health').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      version: '0.0.1',
      time: NOW,
      database: 'ok',
    });
  });

  it('returns 404 for unknown routes', async () => {
    await request(app).get('/api/nope').expect(404);
  });
});
