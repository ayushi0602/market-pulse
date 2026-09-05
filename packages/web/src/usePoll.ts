import { useCallback, useEffect, useState } from 'react';

/**
 * Re-reads an endpoint on an interval.
 *
 * Polling, not a socket. The server has one process, one SQLite file and a
 * generator on a timer; a WebSocket layer would add a connection lifecycle, a
 * reconnect policy and a second delivery path for the same data, in exchange
 * for latency nobody is measuring. When there is a real ingestion pipeline that
 * is the moment to reconsider, not before.
 *
 * Failures keep the previous data on screen. A dropped request is not a reason
 * to blank a page the user is reading -- the error surfaces beside the content
 * and the next tick usually clears it.
 *
 * Deliberately no "last loaded at" timestamp. It was here, and nothing rendered
 * it: the freshness the user cares about is the server's `lastTickAt`, not the
 * moment this browser happened to ask. A field whose only consumer was a
 * condition that could never be false is not an abstraction, it is a leftover.
 */
export interface Polled<T> {
  data: T | undefined;
  error: string | undefined;
  /** Forces an immediate re-read. */
  refresh: () => void;
  /**
   * Adopts a value the caller already has.
   *
   * Write endpoints return the updated resource, so a re-read after a write
   * would spend a round trip to learn what the response just said -- and leave
   * the old list on screen until it landed. The next poll takes over from here.
   */
  override: (next: T) => void;
}

export function usePoll<T>(
  /** Must be stable — wrap it in `useCallback`, or the poll restarts every render. */
  load: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
): Polled<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const run = () => {
      load(controller.signal)
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setError(undefined);
        })
        .catch((cause: unknown) => {
          if (cancelled || controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : 'Unknown error');
        });
    };

    run();
    const timer = intervalMs > 0 ? setInterval(run, intervalMs) : undefined;
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearInterval(timer);
    };
  }, [load, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const override = useCallback((next: T) => {
    setData(next);
    setError(undefined);
  }, []);

  return { data, error, refresh, override };
}
