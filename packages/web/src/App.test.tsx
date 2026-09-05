import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttentionFeedResponse } from '@market-pulse/domain';
import { App } from './App.js';

/**
 * The app opens on the watchlist, so every attention-feed test navigates there
 * first. That is the real entry point, and a test that skipped it would be
 * asserting against a screen users do not land on.
 */
async function openAttentionTab() {
  fireEvent.click(await screen.findByRole('tab', { name: 'While you were away' }));
}

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
      signalContext: undefined,
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
      signalContext: undefined,
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

const emptyWatchlist = { userId: 'demo', rows: [] };

/**
 * The page furniture every screen loads: where prices come from, and which
 * instruments have a story. Answered here so each test can keep describing only
 * the endpoint it is actually about.
 */
const marketStatus = {
  source: 'simulated',
  running: true,
  intervalMs: 3000,
  lastTickAt: 1_700_000_000_000,
  instruments: 3,
  sequence: 2,
};

const replayCatalogue = {
  instruments: [{ instrumentId: 'RELIANCE', events: 2, largestMoveBps: 989 }],
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(ambient(url) ?? handler(url, init)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Returns a canned body for the ambient endpoints, or undefined to defer. */
function ambient(url: string): unknown {
  if (url.includes('market-status')) return marketStatus;
  if (url.includes('replay/instruments')) return replayCatalogue;
  return undefined;
}

describe('the returning user sees what they missed', () => {
  it('leads with the number of meaningful changes', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : goldenFeed));
    render(<App />);
    await openAttentionTab();

    expect(await screen.findByRole('heading', { name: 'While you were away' })).toBeDefined();
    // Scoped to the page subtitle: the count also appears on the story card
    // header now, so an unscoped query matches both.
    expect(screen.getByText('2 meaningful changes across 1 instrument.')).toBeDefined();
  });

  it('shows the decline and the recovery, with the prices that bracket them', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : goldenFeed));
    render(<App />);
    await openAttentionTab();

    await screen.findByRole('heading', { name: 'While you were away' });
    expect(screen.getByText(/Fell 9\.00%/)).toBeDefined();
    expect(screen.getByText(/Recovered 9\.89%/)).toBeDefined();
    expect(screen.getByText(/₹2,900\.00 → ₹2,639\.00/)).toBeDefined();
  });

  it('states plainly that a snapshot view would show nothing', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : goldenFeed));
    render(<App />);
    await openAttentionTab();

    await screen.findByRole('heading', { name: 'While you were away' });
    expect(screen.getByText(/would have shown you 0\.00% and nothing else/)).toBeDefined();
  });
});

describe('the comparison toggle', () => {
  it('shows the traditional view reporting no change on the same data', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : goldenFeed));
    render(<App />);
    await openAttentionTab();

    await screen.findByRole('heading', { name: 'While you were away' });
    fireEvent.click(screen.getByRole('button', { name: 'Traditional watchlist' }));

    // The whole argument in one screen: same events, 0.00%, and an admission.
    // No "+" on a flat change -- a sign would imply a direction there isn't one.
    expect(screen.getByText('0.00%')).toBeDefined();
    expect(screen.getByText(/No change since your last check/)).toBeDefined();
    expect(screen.getByText(/cannot show them/)).toBeDefined();
    expect(screen.queryByText(/Fell 9\.00%/)).toBeNull();
  });

  it('returns to the Market Pulse view', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : goldenFeed));
    render(<App />);
    await openAttentionTab();

    await screen.findByRole('heading', { name: 'While you were away' });
    fireEvent.click(screen.getByRole('button', { name: 'Traditional watchlist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Market Pulse' }));
    expect(screen.getByText(/Fell 9\.00%/)).toBeDefined();
  });
});

describe('F1 at the client boundary: rendering never acknowledges', () => {
  it('issues no write request when the feed is displayed', async () => {
    const spy = stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : goldenFeed));
    render(<App />);
    await openAttentionTab();

    await screen.findByRole('heading', { name: 'While you were away' });

    const writes = spy.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(0);
  });

  it('acknowledges only when the user asks, and only up to what was shown', async () => {
    let acknowledged = false;
    const spy = stubFetch((url) => {
      if (url.includes('watchlist')) return emptyWatchlist;
      if (url.includes('/ack')) {
        acknowledged = true;
        return { userId: 'demo', lastSeenSequence: 2 };
      }
      return acknowledged ? emptyFeed : goldenFeed;
    });

    render(<App />);
    await openAttentionTab();
    await screen.findByRole('heading', { name: 'While you were away' });
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
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : emptyFeed));
    render(<App />);
    await openAttentionTab();

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
    await openAttentionTab();
    expect(await screen.findByText('Something went wrong')).toBeDefined();
    // Twice, deliberately: the market strip says the data source is
    // unreachable, and the screen the user asked for says why it is empty.
    expect(screen.getAllByText(/API responded 500/)).toHaveLength(2);
  });
});

describe('ranking and narrative are separated', () => {
  const twoInstruments: AttentionFeedResponse = {
    ...goldenFeed,
    summary: {
      meaningfulChanges: 3,
      instruments: [
        ...goldenFeed.summary.instruments,
        {
          instrumentId: 'INFY',
          priceWhenLastSeen: 150_000,
          latestPrice: 120_000,
          netChangeBps: -2000,
          meaningfulChanges: 1,
        },
      ],
    },
    events: [
      {
        eventId: 'e-3',
        sequence: 3,
        instrumentId: 'INFY',
        direction: 'decline',
        fromPrice: 150_000,
        toPrice: 120_000,
        magnitudeBps: 2000,
        occurredAt: 1_700_020_000_000,
        signalContext: undefined,
      },
      ...goldenFeed.events,
    ],
  };

  it('orders instruments by their largest move', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : twoInstruments));
    render(<App />);
    await openAttentionTab();
    await screen.findByRole('heading', { name: 'While you were away' });

    // INFY moved 20%, RELIANCE's largest was 9.89%.
    const symbols = screen.getAllByText(/^(INFY|RELIANCE)$/).map((el) => el.textContent);
    expect(symbols[0]).toBe('INFY');
    expect(symbols[1]).toBe('RELIANCE');
  });

  it('runs each instrument’s own events in the order they happened', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : twoInstruments));
    render(<App />);
    await openAttentionTab();
    await screen.findByRole('heading', { name: 'While you were away' });

    // The decline caused the recovery, so it is shown first -- even though the
    // recovery is the larger move and would outrank it in a flat list.
    const moves = screen.getAllByText(/^(Fell|Recovered) /).map((el) => el.textContent?.trim());
    expect(moves).toEqual(['Fell 20.00%', 'Fell 9.00%', 'Recovered 9.89%']);
  });

  it('draws the shape of each story', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : twoInstruments));
    render(<App />);
    await openAttentionTab();
    await screen.findByRole('heading', { name: 'While you were away' });

    // RELIANCE returns to its starting price; the caption says so.
    expect(screen.getByText(/exactly where it started/)).toBeDefined();
  });
});

describe('the significance rule is visible, not implied', () => {
  it('explains why an event was recorded, on demand', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : goldenFeed));
    render(<App />);
    await openAttentionTab();
    await screen.findByRole('heading', { name: 'While you were away' });

    // One per event, collapsed by default. `details` keeps its content in the
    // DOM either way, so the meaningful assertion is the open state, not
    // queryability.
    const disclosures = screen.getAllByText('Why is this significant?');
    expect(disclosures).toHaveLength(2);

    const first = disclosures[0];
    if (first === undefined) {
      throw new Error('Expected a disclosure');
    }
    const panel = first.closest('details');
    expect(panel?.open).toBe(false);
    fireEvent.click(first);
    expect(panel?.open).toBe(true);

    // The explanation names the anchor, the move and the rule that fired.
    expect(panel?.textContent).toContain('Anchor when the move began');
    expect(panel?.textContent).toContain('Threshold in force');
    // The threshold comes from the domain rule, not a string typed into the UI.
    expect(panel?.textContent).toContain('5.00%');
    // The first disclosure belongs to the decline, because events inside a
    // story run chronologically -- the fall came before the recovery.
    expect(panel?.textContent).toContain('9.00%');
  });
});

describe('signal context: is this specific to the instrument, or wider?', () => {
  const contextFeed: AttentionFeedResponse = {
    userId: 'demo',
    sinceSequence: 0,
    throughSequence: 3,
    summary: {
      meaningfulChanges: 3,
      instruments: [
        {
          instrumentId: 'RELIANCE',
          priceWhenLastSeen: 290_000,
          latestPrice: 263_900,
          netChangeBps: -900,
          meaningfulChanges: 1,
        },
        {
          instrumentId: 'INFY',
          priceWhenLastSeen: 150_000,
          latestPrice: 120_000,
          netChangeBps: -2000,
          meaningfulChanges: 1,
        },
        {
          instrumentId: 'TATAMOTORS',
          priceWhenLastSeen: 78_000,
          latestPrice: 82_000,
          netChangeBps: 513,
          meaningfulChanges: 1,
        },
      ],
    },
    events: [
      {
        eventId: 'e-outlier',
        sequence: 3,
        instrumentId: 'INFY',
        direction: 'decline',
        fromPrice: 150_000,
        toPrice: 120_000,
        magnitudeBps: 2000,
        occurredAt: 1_700_000_000_000,
        signalContext: 'outlier',
      },
      {
        eventId: 'e-market-wide',
        sequence: 2,
        instrumentId: 'RELIANCE',
        direction: 'decline',
        fromPrice: 290_000,
        toPrice: 263_900,
        magnitudeBps: 900,
        occurredAt: 1_700_000_000_000,
        signalContext: 'market-wide',
      },
      {
        eventId: 'e-specific',
        sequence: 1,
        instrumentId: 'TATAMOTORS',
        direction: 'advance',
        fromPrice: 78_000,
        toPrice: 82_000,
        magnitudeBps: 513,
        occurredAt: 1_700_000_000_000,
        signalContext: 'stock-specific',
      },
    ],
  };

  it('shows a glanceable tag for market-wide and outlier, but not for stock-specific', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : contextFeed));
    const { container } = render(<App />);
    await openAttentionTab();
    await screen.findByRole('heading', { name: 'While you were away' });

    // Scoped to the .context-tag class rather than by text: "Why is this
    // significant?" keeps its content in the DOM even collapsed (a project
    // convention, not an oversight), and it spells out the same words --
    // an unscoped getByText would match the tag and the hidden disclosure
    // row both.
    const tags = [...container.querySelectorAll('.context-tag')].map((el) => el.textContent);
    expect(tags).toContain('Outlier');
    expect(tags).toContain('Market-wide');
    // stock-specific is the base rate, and gets no tag -- only the two
    // exceptional cases are glanceable, per ContextTag's own reasoning.
    expect(tags).toHaveLength(2);
  });

  it('spells out every classification, including stock-specific, inside the disclosure', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : contextFeed));
    render(<App />);
    await openAttentionTab();
    await screen.findByRole('heading', { name: 'While you were away' });

    const disclosures = screen.getAllByText('Why is this significant?');
    for (const summary of disclosures) {
      fireEvent.click(summary);
    }

    const panels = disclosures.map((s) => s.closest('details'));
    const texts = panels.map((p) => p?.textContent ?? '');
    expect(texts.some((t) => t.includes('Market context') && t.includes('Outlier'))).toBe(true);
    expect(texts.some((t) => t.includes('Market context') && t.includes('Market-wide'))).toBe(true);
    expect(texts.some((t) => t.includes('Market context') && t.includes('Stock-specific'))).toBe(
      true,
    );
  });
});

describe('the wording never claims more than the events do', () => {
  const rally: AttentionFeedResponse = {
    userId: 'demo',
    sinceSequence: 0,
    throughSequence: 2,
    summary: {
      meaningfulChanges: 2,
      instruments: [
        {
          instrumentId: 'TATAMOTORS',
          priceWhenLastSeen: 78_000,
          latestPrice: 89_000,
          netChangeBps: 1410,
          meaningfulChanges: 2,
        },
      ],
    },
    events: [
      {
        eventId: 'r-1',
        sequence: 1,
        instrumentId: 'TATAMOTORS',
        direction: 'advance',
        fromPrice: 78_000,
        toPrice: 82_000,
        magnitudeBps: 513,
        occurredAt: 1_699_990_000_000,
        signalContext: undefined,
      },
      {
        eventId: 'r-2',
        sequence: 2,
        instrumentId: 'TATAMOTORS',
        direction: 'advance',
        fromPrice: 82_000,
        toPrice: 89_000,
        magnitudeBps: 854,
        occurredAt: 1_700_000_000_000,
        signalContext: undefined,
      },
    ],
  };

  it('says a rise rose, when nothing fell before it', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : rally));
    render(<App />);
    await openAttentionTab();

    // "Recovered" asserts a prior decline. TATAMOTORS never fell, so saying it
    // would be the UI claiming something the events do not contain.
    expect(await screen.findByText(/Rose 5\.13%/)).toBeDefined();
    expect(screen.getByText(/Rose 8\.54%/)).toBeDefined();
    expect(screen.queryByText(/Recovered/)).toBeNull();
  });

  it('still says recovered when the story contains the fall it came back from', async () => {
    stubFetch((url) => (url.includes('watchlist') ? emptyWatchlist : goldenFeed));
    render(<App />);
    await openAttentionTab();

    expect(await screen.findByText(/Fell 9\.00%/)).toBeDefined();
    expect(screen.getByText(/Recovered 9\.89%/)).toBeDefined();
  });
});

describe('what arrives while the page is open', () => {
  it('counts new events against where the feed stood when it opened', async () => {
    let through = 2;
    stubFetch((url) =>
      url.includes('watchlist')
        ? emptyWatchlist
        : { ...goldenFeed, throughSequence: through, sinceSequence: 0 },
    );
    render(<App />);
    await openAttentionTab();
    await screen.findByRole('heading', { name: 'While you were away' });

    // Nothing has arrived yet, so nothing says it has.
    expect(screen.queryByText(/arrived while this page was open/)).toBeNull();

    through = 5;
    await waitFor(
      () => {
        expect(screen.getByText(/3 changes arrived while this page was open/)).toBeDefined();
      },
      { timeout: 12_000 },
    );

    // The point of the sentence: history moved, the read position did not.
    expect(screen.getByText(/your read position did not/)).toBeDefined();
  }, 20_000);

  it('re-baselines when the reader changes, rather than counting one user against another', async () => {
    stubFetch((url, init) => {
      if (url.includes('watchlist')) return emptyWatchlist;
      const user = url.includes('priya') ? 'priya' : 'demo';
      void init;
      return {
        ...goldenFeed,
        userId: user,
        // priya is further along, so her feed reports a different position --
        // which must read as "a different question", not "3 just arrived".
        sinceSequence: user === 'priya' ? 1 : 0,
        throughSequence: user === 'priya' ? 5 : 2,
      };
    });
    render(<App />);
    await openAttentionTab();
    await screen.findByRole('heading', { name: 'While you were away' });

    fireEvent.change(screen.getByLabelText('User id'), { target: { value: 'priya' } });

    await waitFor(() => {
      expect(screen.getByText(/Read position 1 of 5|Fell 9\.00%/)).toBeDefined();
    });
    expect(screen.queryByText(/arrived while this page was open/)).toBeNull();
  }, 20_000);
});
