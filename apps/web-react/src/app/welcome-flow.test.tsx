import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installApiFixtures } from '../test/api-fixtures';
import { resetWelcomeSessionForTests } from '../features/welcome/use-welcome';
import { App } from './App';

const HIGHLIGHT = '[data-surface-id="settings:remote-access-highlight"]';

function patchCalls(fetchMock: ReturnType<typeof installApiFixtures>) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input) === '/api/onboarding' && String(init?.method ?? 'GET') === 'PATCH',
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/dashboard');
  window.localStorage.clear();
  resetWelcomeSessionForTests();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

test('first launch shows the welcome modal', async () => {
  installApiFixtures({ welcomeSeen: false });
  render(<App />);
  expect(await screen.findByRole('dialog', { name: 'Hi, welcome to Aevra' })).toBeInTheDocument();
});

test('the welcome modal stays hidden once it has been seen', async () => {
  installApiFixtures({ welcomeSeen: true });
  render(<App />);
  await screen.findByRole('heading', { name: 'Dashboard' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole('dialog', { name: 'Hi, welcome to Aevra' })).not.toBeInTheDocument();
});

test('a failed seen check never blocks the UI with the modal', async () => {
  installApiFixtures({
    routes: { '/api/onboarding': new Response('{}', { status: 500 }) },
  });
  render(<App />);
  await screen.findByRole('heading', { name: 'Dashboard' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole('dialog', { name: 'Hi, welcome to Aevra' })).not.toBeInTheDocument();
});

const closePaths: Array<[string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>]> = [
  ['X button', (user) => user.click(screen.getByRole('button', { name: 'Close' }))],
  ['Escape', (user) => user.keyboard('{Escape}')],
  [
    'primary button',
    (user) => user.click(screen.getByRole('button', { name: "Let's set up remote access" })),
  ],
];

for (const [name, close] of closePaths) {
  test(`closing with the ${name} marks seen and highlights remote access for 5 seconds`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = installApiFixtures({ welcomeSeen: false });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'Hi, welcome to Aevra' });
    // Focus moving into the dialog shows its keyboard handlers are live.
    await waitFor(() => expect(dialog).toHaveFocus());

    await close(user);

    await waitFor(() => expect(window.location.hash).toBe('#/settings'));
    expect(screen.queryByRole('dialog', { name: 'Hi, welcome to Aevra' })).not.toBeInTheDocument();
    expect(JSON.parse(String(patchCalls(fetchMock)[0]?.[1]?.body))).toMatchObject({
      completed: true,
    });
    await waitFor(() => expect(document.querySelector(HIGHLIGHT)).toHaveClass('is-highlighted'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(document.querySelector(HIGHLIGHT)).toHaveClass('is-highlighted');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(document.querySelector(HIGHLIGHT)).not.toHaveClass('is-highlighted');
  });
}

test('a failed seen save still closes and is not shown again this session', async () => {
  installApiFixtures({
    welcomeSeen: false,
    mutationResponses: { 'PATCH /api/onboarding': new Response('{}', { status: 500 }) },
  });
  const user = userEvent.setup();
  const { unmount } = render(<App />);
  await screen.findByRole('dialog', { name: 'Hi, welcome to Aevra' });
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(window.location.hash).toBe('#/settings'));
  unmount();

  render(<App />);
  await screen.findByRole('heading', { name: 'Settings' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole('dialog', { name: 'Hi, welcome to Aevra' })).not.toBeInTheDocument();
});
