import type {
  AcknowledgeResponse,
  AttentionFeedResponse,
  MarketStatusResponse,
  ReplayCatalogueResponse,
  ReplayResponse,
  WatchlistResponse,
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

/** Which instruments have a recorded story. Carries no user, like replay itself. */
export async function fetchReplayInstruments(
  signal?: AbortSignal,
): Promise<ReplayCatalogueResponse> {
  const init = signal ? { signal } : {};
  return json<ReplayCatalogueResponse>(await fetch('/api/replay/instruments', init));
}

export async function fetchWatchlist(
  userId: string,
  signal?: AbortSignal,
): Promise<WatchlistResponse> {
  const init = signal ? { signal } : {};
  return json<WatchlistResponse>(
    await fetch(`/api/watchlist?userId=${encodeURIComponent(userId)}`, init),
  );
}

export async function addToWatchlist(
  userId: string,
  instrumentId: string,
): Promise<WatchlistResponse> {
  return json<WatchlistResponse>(
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, instrumentId }),
    }),
  );
}

export async function removeFromWatchlist(
  userId: string,
  instrumentId: string,
): Promise<WatchlistResponse> {
  return json<WatchlistResponse>(
    await fetch(
      `/api/watchlist/${encodeURIComponent(instrumentId)}?userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),
  );
}

/**
 * Where the prices come from, according to the server.
 *
 * The client never decides this. Every freshness label in the UI is repeating
 * what this endpoint said, so a server with no generator running cannot end up
 * behind a page claiming something is updating.
 */
export async function fetchMarketStatus(signal?: AbortSignal): Promise<MarketStatusResponse> {
  const init = signal ? { signal } : {};
  return json<MarketStatusResponse>(await fetch('/api/market-status', init));
}

/** Pauses or resumes generation. Affects future prices only; history is untouched. */
export async function setMarketRunning(running: boolean): Promise<MarketStatusResponse> {
  return json<MarketStatusResponse>(
    await fetch('/api/market-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ running }),
    }),
  );
}
