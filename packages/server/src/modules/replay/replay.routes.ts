import { Router } from 'express';
import type {
  FeedEvent,
  RecordedMarketEvent,
  ReplayCatalogueResponse,
  ReplayResponse,
} from '@market-pulse/domain';
import { instrumentId } from '@market-pulse/domain';
import type { EventStore } from '../market/event-store.js';

export interface ReplayRoutesDeps {
  events: EventStore;
}

function toFeedEvent(record: RecordedMarketEvent): FeedEvent {
  return {
    eventId: record.eventId,
    sequence: record.sequence,
    instrumentId: record.event.instrumentId,
    direction: record.event.direction,
    fromPrice: record.event.fromPrice,
    toPrice: record.event.toPrice,
    magnitudeBps: record.event.magnitudeBps,
    occurredAt: record.event.occurredAt,
  };
}

/**
 * The replay timeline.
 *
 * One route, read-only, and it takes no `WatermarkStore` at all -- so R5 holds
 * because there is nothing here that could advance a read position, not because
 * this module remembers not to. The `EventStore` it does take exposes no update
 * or delete, so R1 holds the same way.
 *
 * Replay state lives entirely in the client. Holding a server-side cursor would
 * mean per-viewer session state, which is exactly the mutable, user-scoped thing
 * replay is supposed not to have.
 */
export function createReplayRoutes({ events }: ReplayRoutesDeps): Router {
  const router = Router();

  router.get('/replay', (req, res) => {
    const raw = req.query['instrumentId'];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      res.status(400).json({ error: 'instrumentId query parameter is required' });
      return;
    }

    const instrument = instrumentId(raw);
    const body: ReplayResponse = {
      instrumentId: instrument,
      // From position 0: the whole story, independent of any user's watermark.
      timeline: events.readAfter(0, instrument).map(toFeedEvent),
    };
    res.json(body);
  });

  /**
   * Which instruments have a story worth stepping through.
   *
   * Also user-free: it reads the shared log and nothing else, so adding it does
   * not weaken R5. Without it the client would have to learn the instrument
   * list from somewhere user-scoped, and a picker built from one user's
   * watchlist would quietly make replay per-user again.
   */
  router.get('/replay/instruments', (_req, res) => {
    const counts = new Map<string, { events: number; largestMoveBps: number }>();
    for (const record of events.readAfter(0)) {
      const existing = counts.get(record.event.instrumentId);
      if (existing === undefined) {
        counts.set(record.event.instrumentId, {
          events: 1,
          largestMoveBps: record.event.magnitudeBps,
        });
      } else {
        existing.events += 1;
        existing.largestMoveBps = Math.max(existing.largestMoveBps, record.event.magnitudeBps);
      }
    }

    const body: ReplayCatalogueResponse = {
      instruments: [...counts.entries()]
        .map(([instrument, stats]) => ({ instrumentId: instrument, ...stats }))
        .sort((a, b) => b.largestMoveBps - a.largestMoveBps),
    };
    res.json(body);
  });

  return router;
}
