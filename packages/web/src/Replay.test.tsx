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
    expect(screen.getByText(/0\.00% vs ₹2,900\.00/)).toBeDefined();
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
