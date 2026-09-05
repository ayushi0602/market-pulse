import type {
  AcknowledgeResponse,
  AttentionFeedResponse,
  InstrumentCatalogueResponse,
  MarketStatusResponse,
  ReplayCatalogueResponse,
  ReplayResponse,
  WatchlistResponse,
} from '@market-pulse/domain';

/**
 * Reads a response, and on failure surfaces what the server actually said.
 *
 * This used to throw `API responded ${status}` and discard the body, so every
 * failure reached the user as a status code: the server's "NIFTY is a market
 * benchmark, not something a watchlist can follow" was rendered as "That did
 * not save — API responded 400." The server writes the error copy because it is
 * the only party that knows why; throwing it away made that work invisible.
 *
 * The status is still the fallback, for a response with no usable body — an
 * intermediary's error page, or a failure with nothing to say.
 */
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  return (await response.json()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const { error } = body as Record<string, unknown>;
      if (typeof error === 'string' && error.trim().length > 0) {
        return error;
      }
    }
  } catch {
    // Not JSON, or an empty body. The status is all there is.
  }
  return `API responded ${response.status}`;
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

/**
 * What this market trades, so the add box can offer rather than ask.
 *
 * Carries no user: the catalogue is a property of the market, not of a reader.
 */
export async function fetchInstruments(signal?: AbortSignal): Promise<InstrumentCatalogueResponse> {
  const init = signal ? { signal } : {};
  return json<InstrumentCatalogueResponse>(await fetch('/api/instruments', init));
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
