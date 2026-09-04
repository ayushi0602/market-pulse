import { randomUUID } from 'node:crypto';
import type { EventId, EventIdSource } from '@market-pulse/domain';
import { eventId } from '@market-pulse/domain';

/**
 * Production event ids.
 *
 * Lives in `server` because the domain may not reach for platform APIs or
 * randomness -- it takes an `EventIdSource` instead, exactly as it takes a
 * `Clock`. Tests use `sequentialIds()` from the domain and stay deterministic.
 */
export const uuidEventIds: EventIdSource = {
  next: (): EventId => eventId(randomUUID()),
};
