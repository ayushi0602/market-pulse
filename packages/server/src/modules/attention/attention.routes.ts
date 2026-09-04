import { Router } from 'express';
import type {
  AcknowledgeResponse,
  AttentionFeedResponse,
  FeedEvent,
  RecordedMarketEvent,
} from '@market-pulse/domain';
import { rankBySignificance, summariseUnread, userId } from '@market-pulse/domain';
import type { EventStore } from '../market/event-store.js';
import type { WatermarkStore } from './watermark-store.js';

export interface AttentionRoutesDeps {
  events: EventStore;
  watermarks: WatermarkStore;
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
 * "What happened while I was away."
 *
 * The shape of this module is one product decision made twice:
 *
 *   GET  /attention-feed   reads. It never writes.
 *   POST /attention-feed/ack  acknowledges. Only the client decides when.
 *
 * Advancing the watermark on read would be the natural-looking shortcut and it
 * would be a correctness bug. A flaky connection, a background prefetch, a
 * refresh, a second tab -- any of those would silently consume events the user
 * never saw, and there is no way to recover them: the watermark only moves
 * forward. Displaying and acknowledging are different events in the world, so
 * they are different requests here (F1).
 */
export function createAttentionRoutes({ events, watermarks }: AttentionRoutesDeps): Router {
  const router = Router();

  router.get('/attention-feed', (req, res) => {
    const rawUser = req.query['userId'];
    if (typeof rawUser !== 'string' || rawUser.trim().length === 0) {
      res.status(400).json({ error: 'userId query parameter is required' });
      return;
    }

    const user = userId(rawUser);
    const watermark = watermarks.get(user);
    const unread = events.readAfter(watermark.lastSeenSequence);

    const body: AttentionFeedResponse = {
      userId: user,
      sinceSequence: watermark.lastSeenSequence,
      // The head as of this read. The client acknowledges this, not whatever the
      // head becomes later -- otherwise events arriving between the read and the
      // acknowledgement would be marked seen without ever being shown.
      throughSequence: events.head(),
      summary: {
        meaningfulChanges: unread.length,
        instruments: summariseUnread(unread).map((summary) => ({
          instrumentId: summary.instrumentId,
          priceWhenLastSeen: summary.priceWhenLastSeen,
          latestPrice: summary.latestPrice,
          netChangeBps: summary.netChangeBps,
          meaningfulChanges: summary.meaningfulChanges,
        })),
      },
      events: rankBySignificance(unread).map(toFeedEvent),
    };

    res.json(body);
  });

  router.post('/attention-feed/ack', (req, res) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'Body must be an object' });
      return;
    }

    const { userId: rawUser, throughSequence } = body as Record<string, unknown>;
    if (typeof rawUser !== 'string' || rawUser.trim().length === 0) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    if (typeof throughSequence !== 'number' || !Number.isInteger(throughSequence)) {
      res.status(400).json({ error: 'throughSequence must be an integer' });
      return;
    }
    if (throughSequence < 0) {
      res.status(400).json({ error: 'throughSequence cannot be negative' });
      return;
    }

    // The store clamps to MAX(existing, incoming) in SQL, so a stale
    // acknowledgement is a no-op rather than an error (F3). Returning the stored
    // value means the client always learns where it actually ended up.
    const stored = watermarks.advanceTo(userId(rawUser), throughSequence);
    const response: AcknowledgeResponse = {
      userId: stored.userId,
      lastSeenSequence: stored.lastSeenSequence,
    };
    res.json(response);
  });

  return router;
}
