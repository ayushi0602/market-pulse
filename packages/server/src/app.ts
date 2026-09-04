import express, { type Express } from 'express';
import { systemClock, type Clock } from '@market-pulse/domain';
import type { Database } from './db/connection.js';
import { createSystemRoutes } from './modules/system/system.routes.js';

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

  app.use(express.json());
  app.use('/api', createSystemRoutes({ db, clock, version }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}
