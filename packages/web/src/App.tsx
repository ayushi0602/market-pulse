import { useEffect, useState } from 'react';
import type { HealthResponse } from '@market-pulse/domain';

type Probe =
  | { state: 'loading' }
  | { state: 'ok'; health: HealthResponse }
  | { state: 'error'; message: string };

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const init = signal ? { signal } : {};
  const response = await fetch('/api/health', init);
  if (!response.ok) {
    throw new Error(`API responded ${response.status}`);
  }
  return (await response.json()) as HealthResponse;
}

/**
 * Scaffold shell. This is intentionally not a product screen: it exists only to
 * prove that the browser, the dev proxy, and the API are wired together.
 */
export function App() {
  const [probe, setProbe] = useState<Probe>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => setProbe({ state: 'ok', health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProbe({
          state: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Market Pulse</h1>
      <p>What happened while you were away, and why it mattered.</p>
      <p data-testid="api-status">
        {probe.state === 'loading' && 'Checking API…'}
        {probe.state === 'ok' &&
          `API ok — v${probe.health.version}, database ${probe.health.database}`}
        {probe.state === 'error' && `API unreachable — ${probe.message}`}
      </p>
    </main>
  );
}
