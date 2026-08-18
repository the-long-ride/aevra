import { render, screen } from '@testing-library/react';
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
