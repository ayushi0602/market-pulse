import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import { fixedClock } from '@market-pulse/domain';
import { openDatabase, type Database } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp, errorHandler } from '../src/app.js';

const NOW = 1_700_000_000_000;

/**
 * Every failure answers in the same shape.
 *
 * Found live: with no error-handling middleware registered, anything
 * `express.json()` rejected fell through to Express's default handler and came
 * back as an HTML page containing a stack trace and absolute filesystem paths
 * -- on every POST endpoint in the API. A client that expects `{ error }` JSON
 * gets HTML and throws on it, and the response tells a stranger where the code
 * lives on disk.
 */
describe('every error answers as JSON, and discloses nothing', () => {
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

  // Every endpoint that accepts a body, so a future route cannot quietly opt
  // out of the contract by being added without a test.
  const postEndpoints = ['/api/watchlist', '/api/attention-feed/ack', '/api/market-status'];

  for (const endpoint of postEndpoints) {
    it(`answers 400 JSON for a malformed body on ${endpoint}`, async () => {
      const response = await request(app)
        .post(endpoint)
        .set('content-type', 'application/json')
        .send('{not json');

      expect(response.status).toBe(400);
      expect(response.type).toBe('application/json');
      expect(response.body).toEqual({ error: 'Body must be valid JSON' });
    });

    it(`leaks no stack trace or filesystem path from ${endpoint}`, async () => {
      const response = await request(app)
        .post(endpoint)
        .set('content-type', 'application/json')
        .send('{not json');

      expect(response.text).not.toMatch(/<!DOCTYPE|<html/i);
      expect(response.text).not.toMatch(/node_modules/);
      expect(response.text).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\/);
      expect(response.text).not.toMatch(/SyntaxError|\bat \w+ \(/);
    });
  }

  it('answers 413 JSON for a body past the parser limit', async () => {
    const response = await request(app)
      .post('/api/watchlist')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ userId: 'demo', instrumentId: 'A'.repeat(200_000) }));

    expect(response.status).toBe(413);
    expect(response.type).toBe('application/json');
    expect(response.body).toEqual({ error: 'Request body is too large' });
  });

  it('still answers 404 as JSON for an unknown path', async () => {
    const response = await request(app).get('/api/nope');

    expect(response.status).toBe(404);
    expect(response.type).toBe('application/json');
    expect(response.body).toEqual({ error: 'Not Found' });
  });
});

/**
 * The fallback branch: something threw that nobody anticipated.
 *
 * Driven against `errorHandler` directly rather than through `createApp`,
 * because there is deliberately no route in the real API that can be made to
 * throw on demand -- and adding one so a test could reach it would be building
 * a defect to test the handling of defects. The handler is the unit; this
 * mounts it behind a route that throws, exactly as `createApp` mounts it.
 */
describe('an unexpected throw does not become an HTML stack trace', () => {
  it('answers 500 with a generic body and keeps the detail on the server', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('secret detail at /Users/someone/market-pulse/src/thing.ts');
    });
    app.use(errorHandler);

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await request(app).get('/boom');

    expect(response.status).toBe(500);
    expect(response.type).toBe('application/json');
    expect(response.body).toEqual({ error: 'Internal Server Error' });
    // The operator still gets the detail; the caller does not.
    expect(logged).toHaveBeenCalled();
    expect(response.text).not.toMatch(/secret detail|\/Users\//);

    logged.mockRestore();
  });
});
