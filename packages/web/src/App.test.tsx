import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttentionFeedResponse } from '@market-pulse/domain';
import { App } from './App.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const goldenFeed: AttentionFeedResponse = {
  userId: 'demo',
  sinceSequence: 0,
  throughSequence: 2,
  summary: {
    meaningfulChanges: 2,
    instruments: [
      {
        instrumentId: 'RELIANCE',
        priceWhenLastSeen: 290_000,
        latestPrice: 290_000,
        netChangeBps: 0,
        meaningfulChanges: 2,
      },
    ],
  },
  events: [
    {
      eventId: 'e-2',
      sequence: 2,
      instrumentId: 'RELIANCE',
      direction: 'advance',
      fromPrice: 263_900,
      toPrice: 290_000,
      magnitudeBps: 989,
      occurredAt: 1_700_000_000_000,
    },
    {
      eventId: 'e-1',
      sequence: 1,
      instrumentId: 'RELIANCE',
      direction: 'decline',
      fromPrice: 290_000,
      toPrice: 263_900,
      magnitudeBps: 900,
      occurredAt: 1_699_990_000_000,
    },
  ],
};

const emptyFeed: AttentionFeedResponse = {
  userId: 'demo',
  sinceSequence: 2,
  throughSequence: 2,
  summary: { meaningfulChanges: 0, instruments: [] },
  events: [],
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

describe('the returning user sees what they missed', () => {
  it('leads with the number of meaningful changes', async () => {
    stubFetch(() => goldenFeed);
    render(<App />);

    expect(await screen.findByText('While you were away')).toBeDefined();
    expect(screen.getByText(/2 meaningful changes/)).toBeDefined();
  });

  it('shows the decline and the recovery, with the prices that bracket them', async () => {
    stubFetch(() => goldenFeed);
    render(<App />);

    await screen.findByText('While you were away');
    expect(screen.getByText(/Fell 9\.00%/)).toBeDefined();
    expect(screen.getByText(/Recovered 9\.89%/)).toBeDefined();
    expect(screen.getByText(/₹2,900\.00 → ₹2,639\.00/)).toBeDefined();
  });

  it('states plainly that a snapshot view would show nothing', async () => {
    stubFetch(() => goldenFeed);
    render(<App />);

    await screen.findByText('While you were away');
    expect(screen.getByText(/would have shown you 0\.00% and nothing else/)).toBeDefined();
  });
});

describe('the comparison toggle', () => {
  it('shows the traditional view reporting no change on the same data', async () => {
    stubFetch(() => goldenFeed);
    render(<App />);

    await screen.findByText('While you were away');
    fireEvent.click(screen.getByRole('button', { name: 'Traditional watchlist' }));

    // The whole argument in one screen: same events, 0.00%, and an admission.
    // No "+" on a flat change -- a sign would imply a direction there isn't one.
    expect(screen.getByText('0.00%')).toBeDefined();
    expect(screen.getByText(/No change since your last check/)).toBeDefined();
    expect(screen.getByText(/cannot show them/)).toBeDefined();
    expect(screen.queryByText(/Fell 9\.00%/)).toBeNull();
  });

  it('returns to the Market Pulse view', async () => {
    stubFetch(() => goldenFeed);
    render(<App />);

    await screen.findByText('While you were away');
    fireEvent.click(screen.getByRole('button', { name: 'Traditional watchlist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Market Pulse' }));
    expect(screen.getByText(/Fell 9\.00%/)).toBeDefined();
  });
});

describe('F1 at the client boundary: rendering never acknowledges', () => {
  it('issues no write request when the feed is displayed', async () => {
    const spy = stubFetch(() => goldenFeed);
    render(<App />);

    await screen.findByText('While you were away');

    const writes = spy.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(0);
  });

  it('acknowledges only when the user asks, and only up to what was shown', async () => {
    let acknowledged = false;
    const spy = stubFetch((url) => {
      if (url.includes('/ack')) {
        acknowledged = true;
        return { userId: 'demo', lastSeenSequence: 2 };
      }
      return acknowledged ? emptyFeed : goldenFeed;
    });

    render(<App />);
    await screen.findByText('While you were away');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => {
      expect(screen.getByText('You are all caught up')).toBeDefined();
    });

    const write = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = write?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({
      userId: 'demo',
      // The head as of the read that was displayed -- not a later one.
      throughSequence: 2,
    });
  });
});

describe('the caught-up state', () => {
  it('offers nothing to acknowledge when the feed is empty', async () => {
    stubFetch(() => emptyFeed);
    render(<App />);

    expect(await screen.findByText('You are all caught up')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.queryByRole('button', { name: 'Traditional watchlist' })).toBeNull();
  });
});

describe('failure is explained, not hidden', () => {
  it('reports an unreachable API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    );
    render(<App />);
    expect(await screen.findByText('Something went wrong')).toBeDefined();
    expect(screen.getByText(/API responded 500/)).toBeDefined();
  });
});
