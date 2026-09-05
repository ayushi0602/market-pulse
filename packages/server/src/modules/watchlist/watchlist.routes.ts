import { Router } from 'express';
import type { WatchlistResponse } from '@market-pulse/domain';
import { buildWatchlist, instrumentId, userId } from '@market-pulse/domain';
import { BENCHMARK_SYMBOL } from '../market/catalogue.js';
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
 * What a ticker symbol may look like here.
 *
 * Case is not folded -- storage keys by the exact string, and folding it would
 * be a system-wide normalisation decision rather than a validation one. Indian
 * symbols carry `&` (M&M) and `-` (NIFTY-50) and `.` often enough to admit all
 * three. The ceiling of 20 is generous for a ticker and finite, which is the
 * property that was missing.
 */
const SYMBOL_PATTERN = /^[A-Za-z0-9.&-]{1,20}$/;

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

    /*
     * Both reads are scoped to what this user actually follows.
     *
     * They were `events.readAfter(watermark)` and `snapshots.list()` -- the
     * whole unread log and every snapshot in the database -- with
     * `buildWatchlist` discarding the surplus afterwards. That made the cost of
     * this endpoint proportional to the size of the market's history rather
     * than to the size of the user's list: measured at 3.2 / 9.1 / 26.4 ms
     * against logs of 1k / 5k / 20k events, for a user following exactly one
     * instrument, while the response stayed a constant 0.2 KB. The client polls
     * it every four seconds.
     *
     * `buildWatchlist` is unchanged and still filters by entry, so the response
     * is identical; the difference is only in how much never leaves the
     * database.
     */
    const entries = watchlist.list(user);
    const followed = entries.map((entry) => entry.instrumentId);

    const rows = buildWatchlist(
      entries,
      snapshots.listFor(followed),
      events.readAfterForInstruments(watermark.lastSeenSequence, followed),
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

    /*
     * The benchmark is market context computed *from* the shared event log,
     * not something a watchlist entry may point at. Checked here, before
     * anything is written, so a direct API caller cannot reach past the UI --
     * the UI's own uppercasing is a convenience, never the enforcement.
     *
     * This one comparison folds case, and it is the only thing in the system
     * that does: `instrumentId()` merely trims, and the event, snapshot and
     * watchlist stores all key by the exact string. That asymmetry is
     * deliberate rather than an oversight. Case-folding *storage* would be a
     * system-wide normalization decision with real consequences (two spellings
     * of a symbol silently becoming one row); case-folding this *guard* only
     * widens what the boundary refuses, which is the safe direction. Left
     * case-sensitive, `nifty` sailed past a rule that exists precisely to be
     * unbypassable, and a boundary with a one-keystroke bypass is not a
     * boundary.
     */
    const normalized = instrumentId(instrument);
    if (normalized.toUpperCase() === BENCHMARK_SYMBOL.toUpperCase()) {
      res.status(400).json({
        error: `${BENCHMARK_SYMBOL} is a market benchmark, not something a watchlist can follow`,
      });
      return;
    }

    /*
     * A symbol has a shape, even when it is not one we trade.
     *
     * Following an instrument this fictional market does not trade stays
     * allowed on purpose -- the row reads "Never observed", which is the honest
     * answer and a better one than an invented price. What was not intentional
     * was that *any* string qualified: a 300-character blob and
     * "<script>alert(1)</script>" were both accepted with a 201. That is a
     * storage and rendering concern rather than a product one, and it sat oddly
     * beside the benchmark guard above -- a boundary built with some care for
     * exactly one forbidden symbol, with no rule at all for the rest.
     *
     * Deliberately a shape check, not a membership check against CATALOGUE:
     * membership would quietly reverse the decision recorded above.
     */
    if (!SYMBOL_PATTERN.test(normalized)) {
      res.status(400).json({
        error:
          'instrumentId must be 1–20 characters, using letters, digits, and . & - only ' +
          '(for example RELIANCE, or M&M)',
      });
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
