import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MarketStatusResponse } from '@market-pulse/domain';
import { MarketStatus } from './MarketStatus.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const running: MarketStatusResponse = {
  source: 'simulated',
  running: true,
  intervalMs: 3000,
  lastTickAt: 1_700_000_000_000,
  instruments: 12,
  sequence: 18,
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(handler(url, init)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('the page says where the prices come from', () => {
  it('calls the market simulated, and never live', async () => {
    stubFetch(() => running);
    const { container } = render(<MarketStatus />);

    expect(await screen.findByText(/Simulated market/)).toBeDefined();
    // The whole strip, not one label: this is the element most likely to
    // acquire the word "live" during a UI tidy-up, and it must not.
    expect(container.textContent).not.toMatch(/\blive\b/i);
    expect(container.textContent).not.toMatch(/\breal[- ]time\b/i);
  });

  it('reports how much history there is, and how much of it arrived just now', async () => {
    let sequence = 18;
    stubFetch(() => ({ ...running, sequence }));
    render(<MarketStatus />);

    await screen.findByText(/18 events recorded/);
    // Nothing has arrived yet, so nothing claims it has.
    expect(screen.queryByText(/since you opened/)).toBeNull();

    sequence = 21;
    await waitFor(
      () => {
        expect(screen.getByText(/\+3 since you opened this page/)).toBeDefined();
      },
      { timeout: 4000 },
    );
  });

  it('says plainly when nothing is generating prices', async () => {
    stubFetch(() => ({ ...running, source: 'static', running: false, intervalMs: 0 }));
    render(<MarketStatus />);

    expect(await screen.findByText(/Static data/)).toBeDefined();
    // No control to pause something that is not running.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reports an unreachable API instead of pretending the market is fine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('no', { status: 503 }))),
    );
    render(<MarketStatus />);
    expect(await screen.findByText(/API unreachable/)).toBeDefined();
  });
});

describe('pausing the market', () => {
  it('asks the server to stop, and shows the result', async () => {
    let live = true;
    const spy = stubFetch((_url, init) => {
      if (init?.method === 'POST') {
        const body: unknown = init.body;
        // A RequestInit body is BodyInit | null, so String() risks
        // "[object Object]". Narrow before parsing.
        if (typeof body === 'string') {
          live = (JSON.parse(body) as { running: boolean }).running;
        }
      }
      return { ...running, running: live, intervalMs: live ? 3000 : 0 };
    });

    render(<MarketStatus />);
    fireEvent.click(await screen.findByRole('button', { name: /Pause market/ }));

    expect(await screen.findByText(/Simulated market — paused/)).toBeDefined();

    const write = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = write?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({ running: false });
  });

  it('offers to resume once it is paused', async () => {
    stubFetch(() => ({ ...running, running: false, intervalMs: 0 }));
    render(<MarketStatus />);
    expect(await screen.findByRole('button', { name: /Resume market/ })).toBeDefined();
  });
});
