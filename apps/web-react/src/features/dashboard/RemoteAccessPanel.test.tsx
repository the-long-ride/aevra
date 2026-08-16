import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { ExposureStatus } from '@aevra/admin-contracts';
import { installApiFixtures } from '../../test/api-fixtures';
import { RemoteAccessPanel } from './RemoteAccessPanel';

function exposure(overrides: Partial<ExposureStatus> = {}): ExposureStatus {
  return {
    provider: 'cloudflare',
    state: 'ready',
    localGatewayUrl: 'https://127.0.0.1:47830',
    publicUrl: 'https://aevra.example.com',
    config: { provider: 'cloudflare' },
    oauth: { issuer: 'https://aevra.example.com', resource: 'https://aevra.example.com/mcp' },
    ...overrides,
  } as ExposureStatus;
}

function renderPanel(status: ExposureStatus, onChanged = vi.fn(async () => undefined)) {
  render(<RemoteAccessPanel status={status} onChanged={onChanged} />);
  return onChanged;
}

function mutationCall(
  fetchMock: ReturnType<typeof installApiFixtures>,
  path: string,
  method = 'POST',
) {
  return fetchMock.mock.calls.find(([input, init]) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.pathname + input.search
          : input.url;
    return url === path && String(init?.method ?? 'GET').toUpperCase() === method;
  });
}

test('renders the ready Cloudflare status with endpoints and health rows', () => {
  installApiFixtures();
  renderPanel(
    exposure({
      health: {
        providerProcess: 'running',
        gateway: 'listening',
        publicHttps: '',
        admin: 'ok',
        mcp: 'ok',
        oauth: 'ok',
        tls: 'valid',
      },
      checkedAt: '2026-08-21T10:00:00.000Z',
      message: 'Tunnel healthy',
    }),
  );

  expect(screen.getByText('Cloudflare')).toBeInTheDocument();
  expect(screen.getByText('Tunnel healthy')).toBeInTheDocument();
  expect(screen.getByText('https://127.0.0.1:47830')).toBeInTheDocument();
  expect(screen.getByText('https://aevra.example.com')).toBeInTheDocument();
  expect(screen.getByText('https://aevra.example.com/mcp')).toBeInTheDocument();
  const health = screen.getByLabelText('Exposure health');
  expect(health).toHaveTextContent('Provider processrunning');
  expect(health).toHaveTextContent('TLSvalid');
  expect(health).not.toHaveTextContent('Public HTTPS');
  expect(screen.getByText('2026-08-21T10:00:00.000Z')).toBeInTheDocument();
});

test('falls back to placeholder copy for unconfigured local exposure with restart required', () => {
  installApiFixtures();
  renderPanel(
    exposure({
      provider: 'local',
      state: 'error',
      localGatewayUrl: undefined,
      publicUrl: undefined,
      oauth: undefined,
      restartRequired: true,
    }),
  );

  expect(screen.getByText('Local only')).toBeInTheDocument();
  expect(screen.getByText('Exposure is error.')).toBeInTheDocument();
  expect(screen.getByText('Not started')).toBeInTheDocument();
  expect(screen.getByText('Not exposed')).toBeInTheDocument();
  expect(screen.getByText('Not ready')).toBeInTheDocument();
  expect(screen.getByText(/Restart required/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Exposure health')).not.toBeInTheDocument();
});

test('successful endpoint tests report reachability and refresh the panel', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    mutationResponses: {
      'POST /api/exposure/test': { reachable: true, publicUrl: 'https://aevra.example.com' },
    },
  });
  const onChanged = renderPanel(exposure());

  await user.click(screen.getByRole('button', { name: 'Test endpoint' }));
  expect(await screen.findByText('Endpoint reachable · https://aevra.example.com')).toHaveClass(
    'inline-result',
  );
  await waitFor(() => expect(mutationCall(fetchMock, '/api/exposure/test')).toBeTruthy());
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

test('unreachable endpoints explain the reported reason', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    mutationResponses: {
      'POST /api/exposure/test': { reachable: false, message: 'Tunnel down' },
    },
  });
  renderPanel(exposure());

  await user.click(screen.getByRole('button', { name: 'Test endpoint' }));
  expect(await screen.findByText('Not reachable: Tunnel down')).toBeInTheDocument();
});

test('failed endpoint tests fall back to the state when no message is given', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    mutationResponses: {
      'POST /api/exposure/test': { reachable: false, state: 'degraded' },
    },
  });
  renderPanel(exposure());

  await user.click(screen.getByRole('button', { name: 'Test endpoint' }));
  expect(await screen.findByText('Not reachable: degraded')).toBeInTheDocument();
});

test('network failures during endpoint tests surface the error message', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  renderPanel(exposure());

  await user.click(screen.getByRole('button', { name: 'Test endpoint' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});
