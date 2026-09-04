import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('renders the shell and reports API health', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 'ok', version: '0.0.1', time: 1, database: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );

  render(<App />);

  expect(screen.getByRole('heading', { name: 'Market Pulse' })).toBeDefined();
  await waitFor(() => {
    expect(screen.getByTestId('api-status').textContent).toContain('API ok');
  });
});
