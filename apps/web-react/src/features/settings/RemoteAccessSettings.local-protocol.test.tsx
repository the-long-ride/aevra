import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { RemoteAccessSettings } from './RemoteAccessSettings';

function status() {
  return {
    provider: 'local',
    state: 'ready',
    localGatewayUrl: 'https://127.0.0.1:47830',
    publicUrl: 'https://127.0.0.1:47830',
    config: { provider: 'local' },
    oauth: {
      issuer: 'https://127.0.0.1:47830',
      resource: 'https://127.0.0.1:47830/mcp',
    },
  } as any;
}

test('remote access can save HTTP for the local gateway with the service-boundary warning', async () => {
  const fetchMock = installApiFixtures({ routes: { '/api/exposure/status': status() } });
  render(
    <RemoteAccessSettings status={status()} onChanged={vi.fn().mockResolvedValue(undefined)} />,
  );
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'Local gateway protocol' }));
  await user.click(screen.getByRole('option', { name: 'HTTP' }));
  expect(
    screen.getByText(
      /HTTP applies only to the loopback local gateway.*Admin and MCP remain HTTPS/i,
    ),
  ).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Save remote access' }));
  await waitFor(() => expect(screen.getByText(/Exposure configured: local/)).toBeInTheDocument());

  const call = fetchMock.mock.calls.find(
    ([input, init]) => input === '/api/exposure/config' && init?.method === 'POST',
  );
  expect(call).toBeTruthy();
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({
    provider: 'local',
    localProtocol: 'http',
  });
});

test('direct exposure presents HTTPS-only local gateway guidance', async () => {
  installApiFixtures({ routes: { '/api/exposure/status': status() } });
  render(
    <RemoteAccessSettings status={status()} onChanged={vi.fn().mockResolvedValue(undefined)} />,
  );
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'Exposure provider' }));
  await user.click(screen.getByRole('option', { name: 'Direct HTTPS' }));

  expect(screen.getByText(/Direct exposure requires HTTPS/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Local gateway protocol' })).not.toBeInTheDocument();
});
