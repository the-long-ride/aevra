import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { RemoteAccessSettings } from './RemoteAccessSettings';

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

type FetchMock = ReturnType<typeof installApiFixtures>;

function renderSettings(statusOverrides: Record<string, unknown> = {}) {
  const onChanged = vi.fn(async () => undefined);
  const fetchMock = installApiFixtures({
    routes: { '/api/exposure/status': exposure(statusOverrides) },
  });
  render(<RemoteAccessSettings status={exposure(statusOverrides) as any} onChanged={onChanged} />);
  return { onChanged, fetchMock };
}

function savedBody(fetchMock: FetchMock) {
  const calls = fetchMock.mock.calls.filter(
    ([input, init]) => input === '/api/exposure/config' && init?.method === 'POST',
  );
  const call = calls.at(-1);
  expect(call, 'expected a POST to /api/exposure/config').toBeTruthy();
  return JSON.parse(String(call?.[1]?.body));
}

async function chooseProvider(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Exposure provider' }));
  await user.click(screen.getByRole('option', { name }));
  return user;
}

async function chooseOption(ariaLabel: string, name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: ariaLabel }));
  await user.click(screen.getByRole('option', { name }));
  return user;
}

async function type(label: string, value: string) {
  const user = userEvent.setup();
  const field = screen.getByLabelText(label) as HTMLInputElement;
  await user.clear(field);
  await user.type(field, value);
}

test('saving the local provider posts a minimal config', async () => {
  const { fetchMock } = renderSettings();
  const user = await chooseProvider('Local only');

  await user.click(screen.getByRole('button', { name: 'Save remote access' }));

  await waitFor(() => expect(screen.getByText(/Exposure configured: local/)).toBeInTheDocument());
  expect(savedBody(fetchMock)).toEqual({ provider: 'local' });
});

test('direct and external providers publish the entered public URL', async () => {
  const { onChanged, fetchMock } = renderSettings();

  let user = await chooseProvider('Direct HTTPS');
  await type('Public HTTPS URL', 'https://aevra.example.com');
  await type('Direct bind host', '127.0.0.1');
  await user.click(screen.getByRole('button', { name: 'Save remote access' }));
  await waitFor(() => expect(screen.getByText(/Exposure configured: direct/)).toBeInTheDocument());
  expect(savedBody(fetchMock)).toEqual({
    provider: 'direct',
    publicUrl: 'https://aevra.example.com',
    direct: { host: '127.0.0.1' },
  });
  await waitFor(() => expect(onChanged).toHaveBeenCalled());

  user = await chooseProvider('External / Custom');
  expect(screen.getByTestId('external-provider-hints')).toHaveTextContent('reverse SSH');
  await type('Public HTTPS URL', 'https://proxy.example.com');
  await user.click(screen.getByRole('button', { name: 'Save remote access' }));
  await waitFor(() =>
    expect(screen.getByText(/Exposure configured: external/)).toBeInTheDocument(),
  );
  expect(savedBody(fetchMock)).toEqual({
    provider: 'external',
    publicUrl: 'https://proxy.example.com',
  });
});

test('ngrok saves no public URL while managed and one when owned externally', async () => {
  const { fetchMock } = renderSettings();

  await chooseProvider('ngrok');
  let user = await chooseOption('ngrok ownership', 'Managed by Aevra');
  await user.click(screen.getByRole('button', { name: 'Save remote access' }));
  await waitFor(() => expect(screen.getByText(/Exposure configured: ngrok/)).toBeInTheDocument());
  expect(savedBody(fetchMock)).toEqual({
    provider: 'ngrok',
    ngrok: { ownership: 'managed' },
  });

  user = await chooseOption('ngrok ownership', 'External process');
  await type('Public HTTPS URL', 'https://tunnel.example.com');
  await user.click(screen.getByRole('button', { name: 'Save remote access' }));
  await waitFor(() =>
    expect(screen.getAllByText(/Exposure configured: ngrok/).length).toBeGreaterThan(0),
  );
  expect(savedBody(fetchMock)).toEqual({
    provider: 'ngrok',
    publicUrl: 'https://tunnel.example.com',
    ngrok: { ownership: 'external' },
  });
});

test('cloudflare oauth saves hostname derived URLs without Access fields', async () => {
  const { fetchMock } = renderSettings();

  const user = await chooseProvider('Cloudflare');
  await type('Public Aevra hostname', 'aevra.example.com');
  await type('Tunnel ID', 'tunnel-1');
  await user.click(screen.getByRole('button', { name: 'Save remote access' }));

  await waitFor(() =>
    expect(screen.getByText(/Exposure configured: cloudflare/)).toBeInTheDocument(),
  );
  expect(savedBody(fetchMock)).toEqual({
    provider: 'cloudflare',
    publicUrl: 'https://aevra.example.com',
    cloudflare: {
      hostname: 'aevra.example.com',
      tunnelId: 'tunnel-1',
      ownership: 'managed',
      authMode: 'oauth',
      issuer: undefined,
      audience: undefined,
    },
  });
});

test('cloudflare access mode includes issuer and audience values', async () => {
  const { fetchMock } = renderSettings();

  await chooseProvider('Cloudflare');
  await chooseOption('Cloudflare outer authentication', 'Cloudflare Access plus Aevra');
  await type('Public Aevra hostname', 'team.example.com');
  await type('Access issuer', 'https://team.cloudflareaccess.com');
  await type('Audience', 'aud-1');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Save remote access' }));

  await waitFor(() =>
    expect(screen.getAllByText(/Exposure configured: cloudflare/).length).toBeGreaterThan(0),
  );
  const body = savedBody(fetchMock);
  expect(body.cloudflare.authMode).toBe('access');
  expect(body.cloudflare.issuer).toBe('https://team.cloudflareaccess.com');
  expect(body.cloudflare.audience).toBe('aud-1');
});

test('failed saves surface the server error message instead of success copy', async () => {
  renderSettings();
  installApiFixtures({
    mutationResponses: {
      'POST /api/exposure/config': new Response(
        JSON.stringify({ error: { code: 'INVALID', message: 'Insecure public URL' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    },
  });

  const user = await chooseProvider('Local only');
  await user.click(screen.getByRole('button', { name: 'Save remote access' }));

  expect(await screen.findByText('Insecure public URL')).toBeInTheDocument();
});

test('authenticate Cloudflare reports the returned message or a default', async () => {
  const { fetchMock } = renderSettings();
  await chooseProvider('Cloudflare');

  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Authenticate Cloudflare' }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([input]) => input === '/api/cloudflare/authenticate')).toBe(
      true,
    ),
  );
  await waitFor(() =>
    expect(screen.getByText('Cloudflare authentication completed.')).toBeInTheDocument(),
  );
});

test('cloudflare fields left blank omit derived URLs and identifiers entirely', async () => {
  const { fetchMock } = renderSettings();

  await chooseProvider('Cloudflare');
  await type('Public Aevra hostname', '   ');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Save remote access' }));

  await waitFor(() =>
    expect(screen.getByText(/Exposure configured: cloudflare/)).toBeInTheDocument(),
  );
  const body = savedBody(fetchMock);
  expect(body.publicUrl).toBeUndefined();
  expect(body.cloudflare.hostname).toBeUndefined();
  expect(body.cloudflare.tunnelId).toBeUndefined();
});

test('authenticate failures surface the provider error message', async () => {
  renderSettings();
  installApiFixtures({
    mutationResponses: {
      'POST /api/cloudflare/authenticate': new Response(
        JSON.stringify({ error: { code: 'NO_TUNNEL', message: 'cloudflared not found' } }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    },
  });

  await chooseProvider('Cloudflare');
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Authenticate Cloudflare' }));

  expect(await screen.findByText('cloudflared not found')).toBeInTheDocument();
});
