import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReplayResponse } from '@market-pulse/domain';
import { ReplayView } from './Replay.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const goldenTimeline: ReplayResponse = {
  instrumentId: 'RELIANCE',
  timeline: [
    {
      eventId: 'e-1',
      sequence: 1,
      instrumentId: 'RELIANCE',
      direction: 'decline',
      fromPrice: 290_000,
      toPrice: 263_900,
      magnitudeBps: 900,
      occurredAt: 1_700_000_000_000,
      signalContext: undefined,
    },
    {
      eventId: 'e-2',
      sequence: 2,
      instrumentId: 'RELIANCE',
      direction: 'advance',
      fromPrice: 263_900,
      toPrice: 290_000,
      magnitudeBps: 989,
      occurredAt: 1_700_010_000_000,
      signalContext: undefined,
    },
  ],
};

/**
 * The picker asks which instruments have a story before the timeline loads.
 * These tests are about the timeline, so it gets a fixed one-entry answer and
 * the component is told which instrument to open on.
 */
function stubFetch(response: ReplayResponse) {
  const catalogue = {
    instruments: [
      {
        instrumentId: response.instrumentId,
        events: response.timeline.length,
        largestMoveBps: 989,
      },
    ],
  };
  const spy = vi.fn((url: string, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(url.includes('replay/instruments') ? catalogue : response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function renderReplay(response = goldenTimeline) {
  const spy = stubFetch(response);
  render(<ReplayView instrumentId="RELIANCE" stepIntervalMs={5} />);
  await screen.findByRole('button', { name: /Next/ });
  return spy;
}

describe('stepping through the story', () => {
  it('starts before anything has happened', async () => {
    await renderReplay();
    expect(screen.getByText('Before you left')).toBeDefined();
    // The percentage and the "vs opening" context are two elements now (a
    // pill plus a caption), so the combined sentence is asserted via the
    // wrapper's text content rather than a single text node.
    expect(screen.getByTestId('replay-net').textContent).toContain('0.00%');
    expect(screen.getByTestId('replay-net').textContent).toContain('vs ₹2,900.00');
    expect(screen.queryByText(/Fell 9\.00%/)).toBeNull();
  });

  it('reveals the decline, then the recovery', async () => {
    await renderReplay();

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText(/Fell 9\.00%/)).toBeDefined();
    expect(screen.getByTestId('replay-net').textContent).toContain('-9.00%');

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText(/Recovered 9\.89%/)).toBeDefined();
  });

  it('ends with the price where it started and the story still on screen', async () => {
    await renderReplay();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    // The payoff: net change back to zero, both events still visible.
    expect(screen.getByTestId('replay-net').textContent).toContain('0.00%');
    expect(screen.getByText(/Fell 9\.00%/)).toBeDefined();
    expect(screen.getByText(/Recovered 9\.89%/)).toBeDefined();
    expect(screen.getByText(/The price went nowhere\. The story did not\./)).toBeDefined();
  });

  it('stops at the end rather than running off it', async () => {
    await renderReplay();
    const next = screen.getByRole('button', { name: /Next/ });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(next).toHaveProperty('disabled', true);
  });

  it('restarts to the beginning', async () => {
    await renderReplay();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Restart/ }));

    expect(screen.getByText('Before you left')).toBeDefined();
    expect(screen.queryByText(/Fell 9\.00%/)).toBeNull();
  });

  it('plays through on its own', async () => {
    await renderReplay();
    fireEvent.click(screen.getByRole('button', { name: /Play/ }));

    await waitFor(() => {
      expect(screen.getByText(/Recovered 9\.89%/)).toBeDefined();
    });
    expect(screen.getByTestId('replay-net').textContent).toContain('0.00%');
  });
});

describe('R5 at the client boundary: watching acknowledges nothing', () => {
  it('issues no write request while stepping through the whole story', async () => {
    const spy = await renderReplay();

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Restart/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    const writes = spy.mock.calls.filter(([, init]) => init?.method !== undefined);
    expect(writes).toHaveLength(0);
    // And it never asked about a user, so it could not have advanced one.
    expect(spy.mock.calls.every(([url]) => !url.includes('userId'))).toBe(true);
  });

  it('fetches the timeline once, not once per step', async () => {
    const spy = await renderReplay();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    // The picker's one-off catalogue read is not a timeline read.
    const timeline = spy.mock.calls.filter(([url]) => !url.includes('replay/instruments'));
    expect(timeline).toHaveLength(1);
  });
});

describe('an instrument with no story', () => {
  it('says so plainly instead of showing an empty player', async () => {
    stubFetch({ instrumentId: 'TCS', timeline: [] });
    render(<ReplayView instrumentId="TCS" stepIntervalMs={5} />);

    expect(await screen.findByText(/never crossed the significance threshold/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
  });
});

describe('choosing which story to replay', () => {
  const catalogue = {
    instruments: [
      { instrumentId: 'INFY', events: 1, largestMoveBps: 2000, isBenchmark: false },
      { instrumentId: 'RELIANCE', events: 2, largestMoveBps: 989, isBenchmark: false },
      { instrumentId: 'NIFTY', events: 2, largestMoveBps: 700, isBenchmark: true },
    ],
  };

  const infyTimeline: ReplayResponse = {
    instrumentId: 'INFY',
    timeline: [
      {
        eventId: 'i-1',
        sequence: 1,
        instrumentId: 'INFY',
        direction: 'decline',
        fromPrice: 150_000,
        toPrice: 120_000,
        magnitudeBps: 2000,
        occurredAt: 1_700_000_000_000,
        signalContext: undefined,
      },
    ],
  };

  function stubBoth() {
    const spy = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('replay/instruments')
              ? catalogue
              : url.includes('RELIANCE')
                ? goldenTimeline
                : infyTimeline,
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('opens on the richest story, not the largest single move', async () => {
    stubBoth();
    render(<ReplayView stepIntervalMs={5} />);

    /*
     * The endpoint orders by largest move, and opening on the first option
     * meant opening on INFY -- one event. A reviewer's first encounter with
     * replay was: press Play, one step, done, while RELIANCE, the round trip
     * the whole product exists to explain, sat further down the list.
     *
     * Most events is the better proxy for "a story worth stepping through".
     * The picker still lists everything largest-move first; only the landing
     * choice changed.
     *
     * A type argument, not an assertion: §4 avoids both `as T` and `!`, and
     * findByRole is generic precisely so the element type can be stated.
     */
    const select = await screen.findByRole<HTMLSelectElement>('combobox');
    expect(select.value).toBe('RELIANCE');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    // Nothing is revealed until the reviewer steps, so the cursor starts here.
    expect(screen.getByText('Before you left')).toBeDefined();
  });

  it('never lands on the benchmark, and labels it when listed', async () => {
    stubBoth();
    render(<ReplayView stepIntervalMs={5} />);

    // NIFTY is refused by watchlists and excluded from the feed; landing a
    // reviewer on it cold, unlabelled, was the one screen where that design
    // intent never reached the interface.
    const select = await screen.findByRole<HTMLSelectElement>('combobox');
    expect(select.value).not.toBe('NIFTY');

    const benchmark = screen
      .getAllByRole('option')
      .find((option) => option.textContent?.startsWith('NIFTY'));
    expect(benchmark?.textContent).toContain('market benchmark');
  });

  it('loads the chosen story and resets the cursor', async () => {
    stubBoth();
    render(<ReplayView stepIntervalMs={5} />);
    await screen.findByRole('combobox');

    // Starts on RELIANCE, the richest story, and steps into its first event.
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText(/Fell 9\.00%/)).toBeDefined();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'INFY' } });

    // A new story starts at the beginning. Carrying the old cursor over would
    // reveal a different instrument's events at a position that means nothing.
    expect(await screen.findByText('Before you left')).toBeDefined();
    expect(screen.queryByText(/Fell 9\.00%/)).toBeNull();
  });

  it('never names a user, whichever story is chosen', async () => {
    const spy = stubBoth();
    render(<ReplayView stepIntervalMs={5} />);
    await screen.findByRole('combobox');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'INFY' } });
    await screen.findByText('Before you left');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByText(/Fell 20\.00%/);

    // R5 at the client boundary: adding a picker must not be the thing that
    // quietly makes replay per-user.
    expect(spy.mock.calls.every(([url]) => !url.includes('userId'))).toBe(true);
  });
});

describe('signal context carries through the cursor', () => {
  const contextTimeline: ReplayResponse = {
    instrumentId: 'RELIANCE',
    timeline: [
      {
        eventId: 'e-1',
        sequence: 1,
        instrumentId: 'RELIANCE',
        direction: 'decline',
        fromPrice: 290_000,
        toPrice: 263_900,
        magnitudeBps: 900,
        occurredAt: 1_700_000_000_000,
        signalContext: 'market-wide',
      },
      {
        eventId: 'e-2',
        sequence: 2,
        instrumentId: 'RELIANCE',
        direction: 'advance',
        fromPrice: 263_900,
        toPrice: 290_000,
        magnitudeBps: 989,
        occurredAt: 1_700_010_000_000,
        signalContext: 'outlier',
      },
    ],
  };

  it('shows the tag for the revealed event, looked up by sequence rather than lost in the round trip', async () => {
    await renderReplay(contextTimeline);

    // toRecord/toFeedEvent, used to feed the domain cursor and StoryPath,
    // carry no signalContext -- if the tag came from that reconstruction
    // instead of the original response, this would render nothing.
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Market-wide')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Outlier')).toBeDefined();
  });
});
