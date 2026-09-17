import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { ADMIN_SURFACE } from '@aevra/admin-contracts';
import { installApiFixtures } from '../test/api-fixtures';
import { App } from './App';

describe('React admin shell', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '#/dashboard');
    window.localStorage.clear();
    installApiFixtures();
  });

  test('renders every shared navigation destination', async () => {
    render(<App />);
    for (const item of ADMIN_SURFACE.navigation) {
      expect(await screen.findByRole('button', { name: item.label })).toBeInTheDocument();
    }
    expect(screen.getByTestId('react-admin-root')).toBeInTheDocument();
  });

  test('navigates to management pages without replacing the shell', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Permissions' }));
    expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument();
    expect(screen.getByTestId('react-admin-root')).toBeInTheDocument();
  });

  test('repeated tab switches synchronously update page state and history', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings');

    await user.click(screen.getByRole('button', { name: 'Guide' }));
    expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/guide');
  });

  test('marks the page container with the active tab id', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('react-admin-root');
    const page = document.querySelector('#page');
    expect(page).toHaveAttribute('data-page', 'dashboard');
    await user.click(await screen.findByRole('button', { name: 'Guide' }));
    expect(page).toHaveAttribute('data-page', 'guide');
  });

  test('places persistent theme control immediately before Requests without navigating', async () => {
    const user = userEvent.setup();
    render(<App />);
    const theme = await screen.findByRole('button', { name: /Switch to .* mode/ });
    const requests = screen.getByRole('button', { name: /Requests/ });
    expect(theme.compareDocumentPosition(requests) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const hash = window.location.hash;
    await user.click(theme);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeDefined());
    expect(window.location.hash).toBe(hash);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  test('offers browser control immediately left of Requests when no extension is paired', async () => {
    installApiFixtures({ browserPaired: false });
    render(<App />);
    const suggestion = await screen.findByRole('button', {
      name: 'Aevra can control your browser',
    });
    const requests = screen.getByRole('button', { name: /Requests/ });
    expect(
      suggestion.compareDocumentPosition(requests) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(suggestion.nextElementSibling).toBe(requests);
  });

  test('does not offer browser control once an extension is paired', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /Requests/ });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Aevra can control your browser' }),
      ).not.toBeInTheDocument(),
    );
  });

  test('shows version, runtime health, requests count, and safe mode from status', async () => {
    installApiFixtures();
    render(<App />);
    expect(await screen.findByText('v0.1.0')).toBeInTheDocument();
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('Worker')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByText('Tunnel')).toBeInTheDocument();
  });

  test('blocks admin content behind a custom login surface until authenticated and supports dark mode toggle', async () => {
    const user = userEvent.setup();
    installApiFixtures({ routes: { '/api/auth/session': { authenticated: false } } });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in to Aevra' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.queryByTestId('react-admin-root')).not.toBeInTheDocument();

    const themeToggle = screen.getByRole('button', { name: /Switch to .* mode/ });
    expect(themeToggle).toBeInTheDocument();
    await user.click(themeToggle);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeDefined());
  });

  test('successful admin login rechecks the session and mounts the existing shell', async () => {
    let authenticated = false;
    const fetchMock = installApiFixtures();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.pathname + input.search
            : input.url;
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (url === '/api/auth/session') {
        return new Response(JSON.stringify({ authenticated }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/auth/login' && method === 'POST') {
        authenticated = true;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return base(input, init);
    });

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByTestId('react-admin-root')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workspaces' })).toBeInTheDocument();
  });

  test('the approval modal closes even when the refresh that follows the decision fails', async () => {
    // The decision POST succeeds; loadRequests then fails. Before the fix the
    // close was sequenced after that refresh, so the modal stayed on screen with
    // no way out except reloading the page.
    const user = userEvent.setup();
    let approved = false;
    const fetchMock = installApiFixtures({
      approvals: [
        {
          id: 'approval-1',
          state: 'PENDING',
          actor: 'connector:ChatGPT',
          risk: 'MEDIUM',
          workspaceId: 'ws-1',
          sessionId: 'session-1',
          operation: { family: 'git:status', capability: 'commands.run' },
          payload: {},
          presentation: {
            title: 'ChatGPT requests commands.run',
            action: 'Run command',
            target: 'git status',
          },
        },
      ],
    });
    const passthrough = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: any, init?: any) => {
      const url = String(typeof input === 'string' ? input : input.url);
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.endsWith('/approve')) {
        approved = true;
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (approved && url === '/api/approvals') throw new Error('network lost');
      return passthrough(input, init);
    });

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Run once' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Approval request' })).toBeNull(),
    );
  });
});
