import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WatchlistResponse } from '@market-pulse/domain';
import { Watchlist } from './Watchlist.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const OBSERVED = 1_700_000_000_000;

const watchlist: WatchlistResponse = {
  userId: 'demo',
  rows: [
    {
      instrumentId: 'RELIANCE',
      latestPrice: 290_000,
      observedAt: OBSERVED,
      meaningfulChanges: 2,
      netChangeBps: 0,
      attention: 'changed',
    },
    {
      instrumentId: 'INFY',
      latestPrice: 120_000,
      observedAt: OBSERVED,
      meaningfulChanges: 1,
      netChangeBps: -2000,
      attention: 'changed',
    },
    {
      instrumentId: 'TCS',
      latestPrice: 380_500,
      observedAt: OBSERVED,
      meaningfulChanges: 0,
      netChangeBps: undefined,
      attention: 'quiet',
    },
  ],
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(handler(url, init)), {
        status: init?.method === 'POST' ? 201 : 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('W1: the watchlist shows everything followed', () => {
  it('lists the quiet instrument alongside the changed ones', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" />);

    expect(await screen.findByTestId('watchlist-TCS')).toBeDefined();
    expect(screen.getByTestId('watchlist-RELIANCE')).toBeDefined();
    expect(screen.getByTestId('watchlist-INFY')).toBeDefined();
  });

  it('says plainly that the quiet one has no meaningful changes', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" />);

    const tcs = await screen.findByTestId('watchlist-TCS');
    expect(tcs.textContent).toContain('No meaningful changes');
    expect(tcs.textContent).toContain('₹3,805.00');
  });
});

describe('the price is labelled as recorded, never live', () => {
  it('says "As recorded" with the observation time', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" />);

    const row = await screen.findByTestId('watchlist-RELIANCE');
    expect(row.textContent).toMatch(/As recorded/);
    expect(row.textContent).not.toMatch(/\bLive\b/i);
    expect(row.textContent).not.toMatch(/\bCurrent price\b/i);
  });

  it('says so explicitly for an instrument never observed', async () => {
    stubFetch(() => ({
      userId: 'demo',
      rows: [
        {
          instrumentId: 'WIPRO',
          latestPrice: undefined,
          observedAt: undefined,
          meaningfulChanges: 0,
          netChangeBps: undefined,
          attention: 'quiet',
        },
      ],
    }));
    render(<Watchlist userId="demo" />);

    const row = await screen.findByTestId('watchlist-WIPRO');
    expect(row.textContent).toContain('Never observed');
    expect(row.textContent).toContain('—');
  });
});

describe('the round trip is distinguished from nothing happening', () => {
  it('says the price came back rather than reporting a flat 0%', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" />);

    const reliance = await screen.findByTestId('watchlist-RELIANCE');
    expect(reliance.textContent).toContain('2 meaningful changes');
    expect(reliance.textContent).toContain('but the price came back');

    // A genuine move reports its size instead.
    expect(screen.getByTestId('watchlist-INFY').textContent).toContain('net -20.00%');
  });
});

describe('managing the list', () => {
  it('adds an instrument', async () => {
    const spy = stubFetch((url, init) =>
      init?.method === 'POST'
        ? {
            userId: 'demo',
            rows: [...watchlist.rows, { ...watchlist.rows[2], instrumentId: 'WIPRO' }],
          }
        : watchlist,
    );
    render(<Watchlist userId="demo" />);
    await screen.findByTestId('watchlist-TCS');

    fireEvent.change(screen.getByLabelText('Instrument symbol'), { target: { value: 'wipro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.getByTestId('watchlist-WIPRO')).toBeDefined();
    });
    const body = spy.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body;
    expect(typeof body).toBe('string');
    // Uppercased before sending, so the user need not care about case.
    expect(JSON.parse(body as string)).toEqual({
      userId: 'demo',
      instrumentId: 'WIPRO',
    });
  });

  it('removes an instrument', async () => {
    const spy = stubFetch((_url, init) =>
      init?.method === 'DELETE'
        ? { userId: 'demo', rows: watchlist.rows.filter((r) => r.instrumentId !== 'TCS') }
        : watchlist,
    );
    render(<Watchlist userId="demo" />);
    await screen.findByTestId('watchlist-TCS');

    fireEvent.click(screen.getByRole('button', { name: 'Remove TCS' }));

    await waitFor(() => {
      expect(screen.queryByTestId('watchlist-TCS')).toBeNull();
    });
    expect(spy.mock.calls.some(([url]) => url.includes('/api/watchlist/TCS'))).toBe(true);
  });

  it('will not submit an empty symbol', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" />);
    await screen.findByTestId('watchlist-TCS');
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true);
  });
});
