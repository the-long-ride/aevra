import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { installApiFixtures } from '../test/api-fixtures';
import { RemoteAccessPanel } from './dashboard/RemoteAccessPanel';
import { SettingsPage } from './settings/SettingsPage';

function exposure(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'local',
    state: 'ready',
    localGatewayUrl: 'https://127.0.0.1:47830',
    publicUrl: 'https://127.0.0.1:47830',
    oauth: {
      issuer: 'https://127.0.0.1:47830',
      resource: 'https://127.0.0.1:47830/mcp',
    },
    ...overrides,
  };
}

test('Remote Access settings exposes all providers and keeps Cloudflare Access fields conditional', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    routes: {
      '/api/exposure/status': exposure(),
    },
  });
  render(<SettingsPage />);

  await screen.findByRole('heading', { name: 'Settings' });
  const provider = screen.getByRole('button', { name: 'Exposure provider' });
  await user.click(provider);
  for (const name of ['Local only', 'Direct HTTPS', 'Cloudflare', 'ngrok', 'External / Custom']) {
    expect(screen.getByRole('option', { name })).toBeInTheDocument();
  }

  await user.click(screen.getByRole('option', { name: 'External / Custom' }));
  expect(screen.getByLabelText('Public HTTPS URL')).toBeInTheDocument();
  expect(screen.queryByLabelText('Access issuer')).not.toBeInTheDocument();
  const hints = screen.getByTestId('external-provider-hints');
  for (const text of ['Caddy', 'Tailscale Funnel', 'FRP', 'reverse SSH', 'another ngrok process']) {
    expect(hints).toHaveTextContent(text);
  }

  await user.click(screen.getByRole('button', { name: 'Exposure provider' }));
  await user.click(screen.getByRole('option', { name: 'Cloudflare' }));
  expect(screen.getByLabelText('Access issuer')).toBeInTheDocument();
  expect(screen.getByLabelText('Audience')).toBeInTheDocument();
});

test('Remote Access panel reports provider-neutral gateway OAuth and health status', () => {
  render(
    <RemoteAccessPanel
      status={
        exposure({
          provider: 'external',
          publicUrl: 'https://proxy.example.com',
          checkedAt: '2026-08-22T00:00:00.000Z',
          health: {
            providerProcess: 'ready',
            gateway: 'reachable',
            publicHttps: 'configured',
            admin: 'reachable',
            mcp: 'reachable',
            oauth: 'healthy',
            tls: 'ready',
          },
        }) as any
      }
      onChanged={async () => {}}
    />,
  );

  const panel = screen.getByTestId('remote-access-status');
  expect(within(panel).getByText('External / Custom')).toBeInTheDocument();
  expect(within(panel).getByText('https://127.0.0.1:47830')).toBeInTheDocument();
  expect(within(panel).getByText('https://proxy.example.com')).toBeInTheDocument();
  expect(within(panel).getByText('https://127.0.0.1:47830/mcp')).toBeInTheDocument();
  for (const label of [
    'Provider process',
    'Gateway',
    'Public HTTPS',
    'Admin',
    'MCP',
    'OAuth',
    'TLS',
  ]) {
    expect(within(panel).getByText(label)).toBeInTheDocument();
  }
  expect(within(panel).getAllByText('reachable')).toHaveLength(3);
  expect(within(panel).getByText('configured')).toBeInTheDocument();
  expect(within(panel).getByText('healthy')).toBeInTheDocument();
  expect(within(panel).getByText('Last checked')).toBeInTheDocument();
});
