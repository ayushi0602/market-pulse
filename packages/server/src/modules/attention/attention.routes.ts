import { Router } from 'express';
import type {
  AcknowledgeResponse,
  AttentionFeedResponse,
  FeedEvent,
  MeaningfulMarketEvent,
  RecordedMarketEvent,
} from '@market-pulse/domain';
import {
  classifySignal,
  instrumentId,
  rankBySignificance,
  summariseUnread,
  userId,
} from '@market-pulse/domain';
import { BENCHMARK_SYMBOL } from '../market/catalogue.js';
import type { EventStore } from '../market/event-store.js';
import type { WatermarkStore } from './watermark-store.js';

export interface AttentionRoutesDeps {
  events: EventStore;
  watermarks: WatermarkStore;
}

const BENCHMARK = instrumentId(BENCHMARK_SYMBOL);

function toFeedEvent(
  record: RecordedMarketEvent,
  benchmarkHistory: readonly MeaningfulMarketEvent[],
): FeedEvent {
  const isBenchmark = record.event.instrumentId === BENCHMARK;
  return {
    eventId: record.eventId,
    sequence: record.sequence,
    instrumentId: record.event.instrumentId,
    direction: record.event.direction,
    fromPrice: record.event.fromPrice,
    toPrice: record.event.toPrice,
    magnitudeBps: record.event.magnitudeBps,
    occurredAt: record.event.occurredAt,
    // Comparing the benchmark against itself is circular, so it gets no
    // verdict -- undefined, not a fabricated one. Every other event is
    // classified against the benchmark's full history (not the unread slice:
    // whether *this user* has seen the benchmark's move is a different
    // question from whether the market actually moved at the time).
    signalContext: isBenchmark ? undefined : classifySignal(record.event, benchmarkHistory),
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
    // The benchmark's *whole* history, not the unread slice -- classifying a
    // stock's move asks what the market was doing at the time, which does not
    // depend on whether this particular user has acknowledged it yet.
    const benchmarkHistory = events.readAfter(0, BENCHMARK).map((record) => record.event);

    // The benchmark moving is context for other events, not itself a thing to
    // read: it is not something either seeded user followed, and it has no
    // signalContext of its own to explain. Excluding it here is what keeps
    // "12 instruments followed, N need your attention" honest once a 13th,
    // unfollowed instrument exists in the shared log.
    const unread = events
      .readAfter(watermark.lastSeenSequence)
      .filter((record) => record.event.instrumentId !== BENCHMARK);

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
      events: rankBySignificance(unread).map((record) => toFeedEvent(record, benchmarkHistory)),
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

    // Clamped to the real head, not trusted as given (F6). Nothing in the wire
    // format stops a client -- buggy or otherwise -- from sending a number far
    // beyond what has actually been recorded. Storing it unclamped would mark
    // every future event up to that number as already read the instant it is
    // appended, which is a silent, much larger version of the exact bug F1
    // exists to prevent: events becoming unreadable without ever being shown.
    const boundedThrough = Math.min(throughSequence, events.head());

    // The store clamps to MAX(existing, incoming) in SQL, so a stale
    // acknowledgement is a no-op rather than an error (F3). Returning the stored
    // value means the client always learns where it actually ended up.
    const stored = watermarks.advanceTo(userId(rawUser), boundedThrough);
    const response: AcknowledgeResponse = {
      userId: stored.userId,
      lastSeenSequence: stored.lastSeenSequence,
    };
    res.json(response);
  });

  return router;
}
