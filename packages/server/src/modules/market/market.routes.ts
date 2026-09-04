import { Router } from 'express';
import type { MarketStatusResponse } from '@market-pulse/domain';
import type { EventStore } from './event-store.js';
import type { Simulator } from './simulator.js';
import { staticStatus } from './simulator.js';

export interface MarketRoutesDeps {
  events: EventStore;
  /** Absent when nothing is generating prices, which is the case in every test. */
  simulator?: Simulator | undefined;
}

/**
 * What the client needs in order to describe the data honestly.
 *
 * The UI puts a freshness claim on every price. Rather than let the client
 * assume where prices come from, the server says so and the client repeats it.
 * When no generator is running this reports `static`, and the UI stops saying
 * anything is updating -- which is the behaviour that makes the claim
 * trustworthy the rest of the time.
 *
 * `sequence` is here so a page can poll one small response to find out whether
 * history grew, instead of re-reading a feed to discover that it did not.
 */
export function createMarketRoutes({ events, simulator }: MarketRoutesDeps): Router {
  const router = Router();

  function status(): MarketStatusResponse {
    return simulator === undefined ? staticStatus(events) : simulator.status();
  }

  router.get('/market-status', (_req, res) => {
    res.json(status());
  });

  /**
   * Pause and resume generation.
   *
   * A demo control, and the reason the simulation is safe to leave on: a
   * reviewer can stop the market moving while they read a screen, then start it
   * again to watch events arrive. It starts and stops a timer and touches
   * nothing else -- there is no endpoint here that can alter or remove what has
   * already been recorded, because history is not the caller's to edit (I2).
   */
  router.post('/market-status', (req, res) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'Body must be an object' });
      return;
    }
    const { running } = body as Record<string, unknown>;
    if (typeof running !== 'boolean') {
      res.status(400).json({ error: 'running must be a boolean' });
      return;
    }
    if (simulator === undefined) {
      res.status(409).json({ error: 'No market simulation is configured on this server' });
      return;
    }

    if (running) {
      simulator.start();
    } else {
      simulator.stop();
    }
    res.json(status());
  });

  return router;
}
