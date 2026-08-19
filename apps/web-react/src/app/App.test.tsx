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
      expect(
        await screen.findByRole('button', { name: item.label }),
      ).toBeInTheDocument();
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

  test('places persistent theme control immediately before Requests without navigating', async () => {
    const user = userEvent.setup();
    render(<App />);
    const theme = await screen.findByRole('button', { name: /Switch to .* mode/ });
    const requests = screen.getByRole('button', { name: /Requests/ });
    expect(
      theme.compareDocumentPosition(requests) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const hash = window.location.hash;
    await user.click(theme);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeDefined());
    expect(window.location.hash).toBe(hash);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  test('shows version, runtime health, requests count, and safe mode from status', async () => {
    installApiFixtures();
    render(<App />);
    expect(await screen.findByText('v0.5.0')).toBeInTheDocument();
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('Worker')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByText('Tunnel')).toBeInTheDocument();
  });
});
