import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ADMIN_SURFACE } from '@aevra/admin-contracts';
import { installApiFixtures } from '../test/api-fixtures';
import { App } from './App';

describe('React admin shell', () => {
  beforeEach(() => {
    window.location.hash = '#/dashboard';
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

  test('drives repeated tab switches through hashchange', async () => {
    const user = userEvent.setup();
    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const hashChanges = vi.fn();
    window.addEventListener('hashchange', hashChanges);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(window.location.hash).toBe('#/settings'));
    await waitFor(() => expect(hashChanges).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guide' }));
    await waitFor(() => expect(window.location.hash).toBe('#/guide'));
    await waitFor(() => expect(hashChanges).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();

    window.removeEventListener('hashchange', hashChanges);
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
