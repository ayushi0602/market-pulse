import { Router } from 'express';
import type { WatchlistResponse } from '@market-pulse/domain';
import { buildWatchlist, instrumentId, userId } from '@market-pulse/domain';
import type { EventStore } from '../market/event-store.js';
import type { SnapshotStore } from '../market/snapshot-store.js';
import type { WatermarkStore } from '../attention/watermark-store.js';
import type { WatchlistStore } from './watchlist-store.js';

export interface WatchlistRoutesDeps {
  watchlist: WatchlistStore;
  snapshots: SnapshotStore;
  events: EventStore;
  watermarks: WatermarkStore;
}

/**
 * The watchlist: what the user follows, with attention derived on read.
 *
 * Every response is assembled from three independent reads -- entries,
 * snapshots, and the events this user has not seen -- and nothing is written.
 * There is no `hasMeaningfulChange` column to keep in sync, because attention
 * is computed (W3).
 *
 * Like the feed, reading here never advances the watermark. Seeing that an
 * instrument needs attention is not the same as having read what happened.
 */
export function createWatchlistRoutes({
  watchlist,
  snapshots,
  events,
  watermarks,
}: WatchlistRoutesDeps): Router {
  const router = Router();

  function requireUser(raw: unknown): string | undefined {
    return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined;
  }

  function respond(rawUser: string): WatchlistResponse {
    const user = userId(rawUser);
    const watermark = watermarks.get(user);
    const rows = buildWatchlist(
      watchlist.list(user),
      snapshots.list(),
      events.readAfter(watermark.lastSeenSequence),
    );

    return {
      userId: user,
      rows: rows.map((row) => ({
        instrumentId: row.instrumentId,
        latestPrice: row.snapshot?.latestPrice,
        observedAt: row.snapshot?.observedAt,
        meaningfulChanges: row.meaningfulChanges,
        netChangeBps: row.netChangeBps,
        attention: row.attention,
      })),
    };
  }

  router.get('/watchlist', (req, res) => {
    const user = requireUser(req.query['userId']);
    if (user === undefined) {
      res.status(400).json({ error: 'userId query parameter is required' });
      return;
    }
    res.json(respond(user));
  });

  router.post('/watchlist', (req, res) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'Body must be an object' });
      return;
    }
    const { userId: rawUser, instrumentId: rawInstrument } = body as Record<string, unknown>;
    const user = requireUser(rawUser);
    const instrument = requireUser(rawInstrument);
    if (user === undefined || instrument === undefined) {
      res.status(400).json({ error: 'userId and instrumentId are required' });
      return;
    }

    watchlist.add(userId(user), instrumentId(instrument));
    res.status(201).json(respond(user));
  });

  router.delete('/watchlist/:instrumentId', (req, res) => {
    const user = requireUser(req.query['userId']);
    const rawInstrument = req.params.instrumentId;
    if (user === undefined || rawInstrument.trim().length === 0) {
      res.status(400).json({ error: 'userId and instrumentId are required' });
      return;
    }

    // Removes a statement of interest. The event log is market history and is
    // not this endpoint's to touch -- it has no way to touch it (W4).
    watchlist.remove(userId(user), instrumentId(rawInstrument));
    res.json(respond(user));
  });

  return router;
}
