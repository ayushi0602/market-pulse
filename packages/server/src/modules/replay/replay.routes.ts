import { Router } from 'express';
import type { FeedEvent, RecordedMarketEvent, ReplayResponse } from '@market-pulse/domain';
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

  return router;
}
