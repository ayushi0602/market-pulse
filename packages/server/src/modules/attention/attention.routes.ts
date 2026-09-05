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
import type { SnapshotStore } from '../market/snapshot-store.js';
import type { WatermarkStore } from './watermark-store.js';

export interface AttentionRoutesDeps {
  events: EventStore;
  watermarks: WatermarkStore;
  /**
   * Read-only on purpose: `Pick<..., 'list'>`, not the whole `SnapshotStore`.
   *
   * The feed needs the latest observation so the two screens can be reconciled,
   * and it has no business recording one. Narrowing the type here keeps that a
   * structural fact rather than a convention -- there is no `record` on this
   * object to call by accident, the same way replay holds no `WatermarkStore`.
   */
  snapshots: Pick<SnapshotStore, 'list'>;
}

const BENCHMARK = instrumentId(BENCHMARK_SYMBOL);

/**
 * How many events one feed response may carry.
 *
 * The unread window is unbounded by design -- that is what "while you were
 * away" means -- so the response had to be bounded somewhere. 50 is a product
 * decision, not a technical limit: it is more than a person will read in one
 * sitting and small enough that a month-long absence does not ship megabytes to
 * a phone on every poll. The summary counts are deliberately not capped, so the
 * page always says how much it is a page *of*.
 */
const EVENT_LIMIT = 50;

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
export function createAttentionRoutes({
  events,
  watermarks,
  snapshots,
}: AttentionRoutesDeps): Router {
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

    const unreadRecords = events.readAfter(watermark.lastSeenSequence);

    /*
     * The boundary comes from the records just read, not from a second call.
     *
     * `events.head()` gave the same answer only because `node:sqlite` is
     * synchronous and a timer cannot preempt a synchronous handler -- the
     * safety came from the runtime rather than from the code, and nothing
     * recorded that. One `await` in this handler, or the async driver the
     * Postgres note in db/connection.ts contemplates, and an event landing
     * between the two calls would be acknowledged without ever being shown:
     * the exact F1 failure this module exists to prevent.
     *
     * Derived from the *unfiltered* read, deliberately. Every record here has
     * been accounted for -- shown, or deliberately withheld as benchmark
     * context -- so all of them are legitimately behind the reader. Taking the
     * last *filtered* record instead would leave a trailing run of benchmark
     * events permanently unreachable, and the watermark would never catch up to
     * a log whose newest entries are the index moving.
     */
    const throughSequence = unreadRecords.at(-1)?.sequence ?? watermark.lastSeenSequence;

    // The benchmark moving is context for other events, not itself a thing to
    // read: it is not something either seeded user followed, and it has no
    // signalContext of its own to explain. Excluding it here is what keeps
    // "12 instruments followed, N need your attention" honest once a 13th,
    // unfollowed instrument exists in the shared log.
    const unread = unreadRecords.filter((record) => record.event.instrumentId !== BENCHMARK);

    const observed = new Map(snapshots.list().map((snapshot) => [snapshot.instrumentId, snapshot]));

    const body: AttentionFeedResponse = {
      userId: user,
      sinceSequence: watermark.lastSeenSequence,
      throughSequence,
      summary: {
        // Both counts cover the whole window, never the page below.
        meaningfulChanges: unread.length,
        instruments: summariseUnread(unread).map((summary) => {
          const snapshot = observed.get(summary.instrumentId);
          return {
            instrumentId: summary.instrumentId,
            priceWhenLastSeen: summary.priceWhenLastSeen,
            latestPrice: summary.latestPrice,
            netChangeBps: summary.netChangeBps,
            meaningfulChanges: summary.meaningfulChanges,
            observedPrice: snapshot?.latestPrice,
            observedAt: snapshot?.observedAt,
          };
        }),
      },
      events: rankBySignificance(unread)
        .slice(0, EVENT_LIMIT)
        .map((record) => toFeedEvent(record, benchmarkHistory)),
      eventLimit: EVENT_LIMIT,
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

    /*
     * A position beyond the log is refused, not clamped (F6).
     *
     * The low side and the high side look symmetrical and are not. A *stale*
     * acknowledgement -- below the watermark -- is clamped to a no-op by
     * `MAX()` in SQL and answered 200, and that is right precisely because it
     * consumes nothing (F3). A position *above* the head is the opposite:
     * clamping it to the head would advance the watermark over events that
     * were never shown, which is the exact failure F1 exists to prevent, made
     * permanent by the fact that watermarks only move forward.
     *
     * `head()` only grows, so a value obtained from any real read can never
     * exceed a later head. Getting here means a buggy client, a forged
     * request, or a client still holding a feed from a database that has since
     * been reset -- and in that last, genuinely reachable case, refusing is
     * what leaves the user's unread events intact for them to actually see.
     * It is also what makes the client's existing message ("Nothing was marked
     * as read. Your position is unchanged.") true rather than a lie.
     */
    const head = events.head();
    if (throughSequence > head) {
      res.status(400).json({
        error: `throughSequence ${throughSequence} is beyond the log head of ${head}`,
      });
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
