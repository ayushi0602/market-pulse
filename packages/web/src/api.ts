import type {
  AcknowledgeResponse,
  AttentionFeedResponse,
  ReplayResponse,
} from '@market-pulse/domain';

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`API responded ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchFeed(
  userId: string,
  signal?: AbortSignal,
): Promise<AttentionFeedResponse> {
  const init = signal ? { signal } : {};
  return json<AttentionFeedResponse>(
    await fetch(`/api/attention-feed?userId=${encodeURIComponent(userId)}`, init),
  );
}

/**
 * Acknowledging is its own request, never a side effect of fetching.
 *
 * The server enforces this too, but the client must not paper over it: a
 * component that acknowledged on render would consume events the user never
 * actually saw, and the watermark only moves forward.
 */
export async function acknowledge(
  userId: string,
  throughSequence: number,
): Promise<AcknowledgeResponse> {
  return json<AcknowledgeResponse>(
    await fetch('/api/attention-feed/ack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, throughSequence }),
    }),
  );
}

export async function fetchReplay(
  instrumentId: string,
  signal?: AbortSignal,
): Promise<ReplayResponse> {
  const init = signal ? { signal } : {};
  return json<ReplayResponse>(
    await fetch(`/api/replay?instrumentId=${encodeURIComponent(instrumentId)}`, init),
  );
}
