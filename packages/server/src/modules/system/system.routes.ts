import { Router } from 'express';
import type { Clock, HealthResponse, ServiceStatus } from '@market-pulse/domain';
import type { Database } from '../../db/connection.js';

export interface SystemRoutesDeps {
  db: Database;
  clock: Clock;
  version: string;
}

/**
 * Operational endpoints. Not a product feature, and not part of the domain --
 * this module exists so that "is the stack wired up correctly?" has an answer.
 */
export function createSystemRoutes({ db, clock, version }: SystemRoutesDeps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    let database: ServiceStatus = 'ok';
    try {
      db.prepare('SELECT 1').get();
    } catch {
      database = 'degraded';
    }

    const body: HealthResponse = {
      status: database === 'ok' ? 'ok' : 'degraded',
      version,
      time: clock.now(),
      database,
    };

    res.status(body.status === 'ok' ? 200 : 503).json(body);
  });

  return router;
}
