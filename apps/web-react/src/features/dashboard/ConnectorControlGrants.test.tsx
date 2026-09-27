import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ConnectorControlGrants } from './ConnectorControlGrants';

test('grants browser control to the exact static connector', async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  let browser = false;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') browser = true;
    return new Response(
      JSON.stringify(
        init?.method === 'POST' ? {} : { connectionId: 'con-1', browser, desktop: false },
      ),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ConnectorControlGrants connectorId="con-1" onChanged={onChanged} />);
  const grant = await screen.findByRole('button', { name: 'Grant browser' });
  await userEvent.setup().click(grant);
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  const request = fetchMock.mock.calls.find(
    ([url, init]) => url === '/api/connectors/con-1/control' && init?.method === 'POST',
  );
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({ capability: 'browser.control' });
  expect(screen.getByRole('button', { name: 'Revoke browser' })).toBeInTheDocument();
});

test('failed connector grant shows an error and remains retryable', async () => {
  let attempts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        attempts += 1;
        return new Response(
          JSON.stringify(attempts === 1 ? { error: { message: 'Grant denied' } } : {}),
          {
            status: attempts === 1 ? 503 : 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return new Response(
        JSON.stringify({ connectionId: 'con-1', browser: attempts > 1, desktop: false }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    }),
  );
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(<ConnectorControlGrants connectorId="con-1" onChanged={onChanged} />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Grant browser' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Grant denied');
  expect(screen.getByRole('button', { name: 'Grant browser' })).toBeEnabled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Grant browser' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke browser' })).toBeEnabled());
  expect(onChanged).toHaveBeenCalled();
});

test('failed connector revoke refreshes persisted grant state and shows the error', async () => {
  let granted = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        granted = false;
        return new Response(JSON.stringify({ error: { message: 'Worker invalidation failed' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ connectionId: 'con-1', browser: granted, desktop: false }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    }),
  );
  render(
    <ConnectorControlGrants connectorId="con-1" onChanged={vi.fn().mockResolvedValue(undefined)} />,
  );
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Revoke browser' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Worker invalidation failed');
  expect(screen.getByRole('button', { name: 'Grant browser' })).toBeEnabled();
});
