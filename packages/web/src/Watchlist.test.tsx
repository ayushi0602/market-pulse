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

const marketStatus = {
  source: 'simulated',
  running: true,
  intervalMs: 3000,
  lastTickAt: OBSERVED,
  instruments: 3,
  sequence: 3,
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify(url.includes('market-status') ? marketStatus : handler(url, init)),
        {
          status: init?.method === 'POST' ? 201 : 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('W1: the watchlist shows everything followed', () => {
  it('lists the quiet instrument alongside the changed ones', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);

    expect(await screen.findByTestId('watchlist-TCS')).toBeDefined();
    expect(screen.getByTestId('watchlist-RELIANCE')).toBeDefined();
    expect(screen.getByTestId('watchlist-INFY')).toBeDefined();
  });

  it('says plainly that the quiet one has no meaningful changes', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);

    const tcs = await screen.findByTestId('watchlist-TCS');
    expect(tcs.textContent).toContain('No meaningful changes');
    expect(tcs.textContent).toContain('₹3,805.00');
  });
});

describe('the price is labelled as recorded, never live', () => {
  it('says "As recorded" with the observation time', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);

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
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);

    const row = await screen.findByTestId('watchlist-WIPRO');
    expect(row.textContent).toContain('Never observed');
    expect(row.textContent).toContain('—');
  });
});

describe('the round trip is distinguished from nothing happening', () => {
  it('says the price came back rather than reporting a flat 0%', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);

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
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);
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
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);
    await screen.findByTestId('watchlist-TCS');

    fireEvent.click(screen.getByRole('button', { name: 'Remove TCS' }));

    await waitFor(() => {
      expect(screen.queryByTestId('watchlist-TCS')).toBeNull();
    });
    expect(spy.mock.calls.some(([url]) => url.includes('/api/watchlist/TCS'))).toBe(true);
  });

  it('will not submit an empty symbol', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);
    await screen.findByTestId('watchlist-TCS');
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true);
  });
});

describe('the reviewer journey', () => {
  it('offers a one-click jump from a changed instrument to what happened', async () => {
    const onViewChanges = vi.fn();
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" onViewChanges={onViewChanges} />);

    await screen.findByTestId('watchlist-RELIANCE');
    const links = screen.getAllByRole('button', { name: /View what happened/ });
    // Offered on the instruments that changed, and not on the quiet one.
    expect(links).toHaveLength(2);
    expect(screen.getByTestId('watchlist-TCS').textContent).not.toContain('View what happened');

    // Narrowed rather than cast or asserted: the lint rule prefers `!` to a
    // cast, and the project prefers neither.
    const [first] = links;
    if (first === undefined) {
      throw new Error('Expected a "View what happened" control');
    }
    fireEvent.click(first);
    expect(onViewChanges).toHaveBeenCalledTimes(1);
  });
});

describe('W1 stays true when the list gets long enough to need grouping', () => {
  it('separates what needs attention from what is quiet', async () => {
    stubFetch(() => watchlist);
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);

    await screen.findByTestId('watchlist-TCS');

    const attention = await screen.findByRole('heading', { name: /Needs your attention/ });
    const quiet = screen.getByRole('heading', { name: /Quiet/ });

    // The grouping is presentation only: every followed instrument is still
    // present, which is the invariant the split could most easily break.
    expect(screen.getByTestId('watchlist-RELIANCE')).toBeDefined();
    expect(screen.getByTestId('watchlist-INFY')).toBeDefined();
    expect(screen.getByTestId('watchlist-TCS')).toBeDefined();

    expect(attention.textContent).toContain('2');
    expect(quiet.textContent).toContain('1');

    // And the quiet one is under the quiet heading, not merely somewhere on
    // the page: comparing document order is what makes this assertion real.
    const tcs = screen.getByTestId('watchlist-TCS');
    expect(quiet.compareDocumentPosition(tcs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(attention.compareDocumentPosition(tcs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const reliance = screen.getByTestId('watchlist-RELIANCE');
    expect(quiet.compareDocumentPosition(reliance) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('shows no group headings when everything is quiet', async () => {
    stubFetch(() => ({
      userId: 'demo',
      rows: watchlist.rows.filter((row) => row.attention === 'quiet'),
    }));
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);

    await screen.findByTestId('watchlist-TCS');
    expect(screen.queryByRole('heading', { name: /Needs your attention/ })).toBeNull();
    expect(screen.getByText(/None need your attention/)).toBeDefined();
  });
});

describe('a price that moves while you are watching', () => {
  it('marks the number that changed, and leaves the others alone', async () => {
    let price = 290_000;
    stubFetch(() => ({
      ...watchlist,
      rows: watchlist.rows.map((row) =>
        row.instrumentId === 'RELIANCE' ? { ...row, latestPrice: price } : row,
      ),
    }));
    render(<Watchlist userId="demo" onViewChanges={() => undefined} />);

    const reliance = await screen.findByTestId('watchlist-RELIANCE');
    expect(reliance.querySelector('.flash-up, .flash-down')).toBeNull();

    price = 295_000;
    await waitFor(
      () => {
        expect(reliance.querySelector('.flash-up')).not.toBeNull();
      },
      { timeout: 6000 },
    );

    // The instrument that did not move is not flashed. A flash on every row on
    // every poll would be noise, and would stop meaning anything.
    expect(screen.getByTestId('watchlist-TCS').querySelector('.flash-up, .flash-down')).toBeNull();
  });
});
