import express, { type Express } from 'express';
import { systemClock, type Clock } from '@market-pulse/domain';
import type { Database } from './db/connection.js';
import { createSystemRoutes } from './modules/system/system.routes.js';
import { createAttentionRoutes } from './modules/attention/attention.routes.js';
import { createEventStore } from './modules/market/event-store.js';
import { createWatermarkStore } from './modules/attention/watermark-store.js';
import { uuidEventIds } from './ids.js';

export interface CreateAppOptions {
  db: Database;
  /** Reported by /api/health. Required so it can never drift from package.json. */
  version: string;
  clock?: Clock;
}

/**
 * Builds the HTTP application without binding a port, so tests can drive it
 * in-process. Feature modules mount their own routers here as they land.
 */
export function createApp({ db, version, clock = systemClock }: CreateAppOptions): Express {
  const app = express();

  const events = createEventStore(db, uuidEventIds, clock);
  const watermarks = createWatermarkStore(db, clock);

  app.use(express.json());
  app.use('/api', createSystemRoutes({ db, clock, version }));
  app.use('/api', createAttentionRoutes({ events, watermarks }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}
