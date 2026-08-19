import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { installApiFixtures } from '../test/api-fixtures';
import { App } from './App';

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.pathname + input.search;
  return new URL(input.url).pathname + new URL(input.url).search;
}

test('delayed Dashboard completion cannot switch the user back from another tab', async () => {
  window.history.replaceState(null, '', '#/settings');
  const baseFetch = installApiFixtures();
  let releaseDashboard!: () => void;

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (requestPath(input) !== '/api/dashboard/runtime') {
        return baseFetch(input, init);
      }
      return new Promise<Response>((resolve) => {
        releaseDashboard = () => {
          void baseFetch(input, init).then(resolve);
        };
      });
    }),
  );

  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Dashboard' }));
  await user.click(screen.getByRole('button', { name: 'Guide' }));
  expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();

  releaseDashboard();
  await waitFor(() => expect(window.location.hash).toBe('#/guide'));
  expect(screen.getByRole('heading', { name: 'Guide' })).toBeInTheDocument();
});

test('popstate restores the page from browser history state', async () => {
  window.history.replaceState(null, '', '#/dashboard');
  installApiFixtures();
  const user = userEvent.setup();
  render(<App />);

  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: 'Guide' }));
  window.history.replaceState(null, '', '#/settings');
  window.dispatchEvent(new PopStateEvent('popstate'));

  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
});
