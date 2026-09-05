import { Router } from 'express';
import type { InstrumentCatalogueResponse, MarketStatusResponse } from '@market-pulse/domain';
import type { EventStore } from './event-store.js';
import type { Simulator } from './simulator.js';
import { staticStatus } from './simulator.js';
import { BENCHMARK_SYMBOL, CATALOGUE } from './catalogue.js';

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
   * What this market trades.
   *
   * Added because the watchlist input was blind free text against a fictional
   * thirteen-symbol market that nobody can be expected to guess. Following a
   * symbol we do not trade is still allowed and still reads "Never observed";
   * the point is that doing so should be a choice rather than an undetectable
   * typo.
   *
   * The benchmark is listed and flagged rather than hidden: it is part of this
   * market, it just cannot be followed, and saying so is more useful than
   * omitting it and letting `POST /watchlist` be the first place anyone finds
   * out.
   */
  router.get('/instruments', (_req, res) => {
    const body: InstrumentCatalogueResponse = {
      instruments: CATALOGUE.map((entry) => ({
        instrumentId: entry.symbol,
        isBenchmark: entry.symbol === BENCHMARK_SYMBOL,
      })),
    };
    res.json(body);
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

    /*
     * Configured, but with nothing to simulate.
     *
     * The generator only tracks instruments it has already observed, so against
     * an unseeded database it tracks none and `start()` returns immediately.
     * This used to answer 200 with `running: false` -- reporting success for an
     * operation that had not happened, leaving the UI's Resume control silently
     * inert with nothing to explain it. A reviewer who runs `npm run dev`
     * before `npm run db:seed` lands here, so the message says what to do.
     */
    if (running && simulator.status().instruments === 0) {
      res.status(409).json({
        error: 'There is nothing to simulate yet — run `npm run db:seed` to build the market',
      });
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
