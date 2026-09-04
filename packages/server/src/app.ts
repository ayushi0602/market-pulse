import express, { type Express } from 'express';
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
  app.use('/api', createAttentionRoutes({ events, watermarks }));
  app.use('/api', createReplayRoutes({ events }));
  app.use('/api', createWatchlistRoutes({ watchlist, snapshots, events, watermarks }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}
