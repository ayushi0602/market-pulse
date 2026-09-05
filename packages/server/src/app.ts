import express, { type ErrorRequestHandler, type Express } from 'express';
import { systemClock, type Clock } from '@market-pulse/domain';
import type { Database } from './db/connection.js';
import { createSystemRoutes } from './modules/system/system.routes.js';
import { createAttentionRoutes } from './modules/attention/attention.routes.js';
import { createReplayRoutes } from './modules/replay/replay.routes.js';
import { createWatchlistRoutes } from './modules/watchlist/watchlist.routes.js';
import { createWatchlistStore } from './modules/watchlist/watchlist-store.js';
import { createSnapshotStore } from './modules/market/snapshot-store.js';
import { createEventStore } from './modules/market/event-store.js';
import { createWatermarkStore } from './modules/attention/watermark-store.js';
import { createMarketRoutes } from './modules/market/market.routes.js';
import type { Simulator } from './modules/market/simulator.js';
import type { EventStore } from './modules/market/event-store.js';
import type { SnapshotStore } from './modules/market/snapshot-store.js';
import { uuidEventIds } from './ids.js';

export interface CreateAppOptions {
  db: Database;
  /** Reported by /api/health. Required so it can never drift from package.json. */
  version: string;
  clock?: Clock;
  /**
   * Builds the price generator, if this process wants one.
   *
   * A factory rather than a `Simulator`, because the stores it needs are
   * created in here. A factory rather than a flag, because `createApp` must not
   * be able to start a timer on its own -- every test builds an app, and a test
   * suite that silently spawns twenty background intervals is a flaky suite.
   * The composition root decides, and it is the only caller that passes this.
   */
  createSimulation?: (deps: {
    events: EventStore;
    snapshots: SnapshotStore;
    clock: Clock;
  }) => Simulator;
}

/**
 * Builds the HTTP application without binding a port, so tests can drive it
 * in-process. Feature modules mount their own routers here as they land.
 */
export function createApp({
  db,
  version,
  clock = systemClock,
  createSimulation,
}: CreateAppOptions): Express {
  const app = express();

  const events = createEventStore(db, uuidEventIds, clock);
  const watermarks = createWatermarkStore(db, clock);
  const snapshots = createSnapshotStore(db, clock);
  const watchlist = createWatchlistStore(db, clock);

  // Note what is not passed in: the generator gets events and snapshots, and no
  // watermark store. A running simulation therefore has no way to advance
  // anyone's read position (I4) -- not by policy, but because it cannot reach
  // one.
  const simulator = createSimulation?.({ events, snapshots, clock });

  app.use(express.json());
  app.use('/api', createSystemRoutes({ db, clock, version }));
  app.use('/api', createMarketRoutes({ events, simulator }));
  app.use('/api', createAttentionRoutes({ events, watermarks, snapshots }));
  app.use('/api', createReplayRoutes({ events }));
  app.use('/api', createWatchlistRoutes({ watchlist, snapshots, events, watermarks }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use(errorHandler);

  return app;
}

/**
 * The last word on every failure, so no request can answer in a shape the
 * client does not expect.
 *
 * Without this, anything `express.json()` rejects falls through to Express's
 * default handler, which replies with an HTML page containing the stack trace
 * and absolute filesystem paths. Three things were wrong with that: every other
 * failure in this API is `{ "error": ... }` JSON and the client's `json()`
 * helper throws on HTML; the response disclosed the dependency layout and the
 * machine's directory structure; and it contradicted this project's own rule
 * that an error is never swallowed to keep a request alive -- it was not
 * swallowed, it was broadcast.
 *
 * Body-parser tags what it rejects, so a malformed body and an oversized one
 * are told apart and answered with the status each deserves. Anything else is
 * genuinely unexpected: it is logged in full on the server, where the operator
 * can see it, and answered with nothing the caller could learn from.
 *
 * Four arguments, including the unused `next`. Express identifies an error
 * handler by arity, so dropping it silently turns this back into ordinary
 * middleware that never runs.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  // A response already on its way cannot be replaced; handing it back to
  // Express is what closes the connection cleanly.
  if (res.headersSent) {
    _next(error);
    return;
  }

  const type = (error as { type?: unknown } | null)?.type;

  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Body must be valid JSON' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large' });
    return;
  }

  console.error('Unhandled error while serving a request:', error);
  res.status(500).json({ error: 'Internal Server Error' });
};
