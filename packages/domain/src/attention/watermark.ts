import type { EventSequence, RecordedMarketEvent } from '../market/log.js';
import { recordsAfter } from '../market/log.js';
import type { UserId } from './user.js';

/**
 * How far one user has read into the shared history.
 *
 * This single number is what makes "while I was away" answerable. The log is
 * shared and identical for everyone; the watermark is what differs, so two
 * people opening the app at the same instant see different things (I4).
 *
 * A watermark is a value, not a cursor object: reading does not advance it, and
 * advancing it produces a new one. Nothing a user does can affect another
 * user's watermark, because there is nothing shared to affect.
 */
export interface UserReadWatermark {
  readonly userId: UserId;
  /** Sequence of the last event this user has seen. 0 means "has seen nothing". */
  readonly lastSeenSequence: number;
}

/** A user who has seen nothing, and so is owed the whole log. */
export function newReader(user: UserId): UserReadWatermark {
  return Object.freeze({ userId: user, lastSeenSequence: 0 });
}

/**
 * A user joining now, who is not owed history from before they arrived.
 *
 * Distinct from `newReader` on purpose: "new to the product" and "new to this
 * instrument" are different situations, and conflating them would greet a first
 * -time user with every event the system has ever recorded.
 */
export function joiningAt(user: UserId, log: EventSequence): UserReadWatermark {
  return Object.freeze({ userId: user, lastSeenSequence: log.head });
}

/**
 * What this user missed: everything appended since they last looked.
 *
 * A pure read over shared history. It does not mutate the log and does not
 * advance the watermark -- displaying an event and acknowledging it are
 * separate decisions, and only the caller knows which one happened.
 */
export function unreadFor(
  watermark: UserReadWatermark,
  log: EventSequence,
): readonly RecordedMarketEvent[] {
  return recordsAfter(log, watermark.lastSeenSequence);
}

export function hasUnread(watermark: UserReadWatermark, log: EventSequence): boolean {
  return log.head > watermark.lastSeenSequence;
}

/**
 * Acknowledges everything currently in the log, returning a new watermark.
 *
 * Never moves backwards: a stale log must not un-read what a user has already
 * seen.
 */
export function markRead(watermark: UserReadWatermark, log: EventSequence): UserReadWatermark {
  if (log.head <= watermark.lastSeenSequence) {
    return watermark;
  }
  return Object.freeze({ userId: watermark.userId, lastSeenSequence: log.head });
}
