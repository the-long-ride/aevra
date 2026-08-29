import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DialogProvider } from '../components/Dialog';
import { installApiFixtures } from '../test/api-fixtures';
import { GuidePage } from './guide/GuidePage';
import { SettingsPage } from './settings/SettingsPage';

function mutationCall(
  fetchMock: ReturnType<typeof installApiFixtures>,
  path: string,
  method: string,
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

function settingsFixtures() {
  return installApiFixtures({
    routes: {
      '/api/settings': { auditRetentionDays: 30 },
      '/api/policy/command-families': { 'git:status': 'READ_ONLY' },
      '/api/policy/network-rules': [
        {
          id: 'network-1',
          effect: 'allow',
          protocol: 'https',
          host: 'api.example.com',
          port: 443,
          workspaceId: 'ws-1',
        },
      ],
      '/api/environment-profiles': [
        { name: 'dev', vars: { NODE_ENV: 'development' }, secretRefs: {} },
      ],
      '/api/secret-references': [{ ref: 'API_TOKEN' }],
    },
  });
}

async function waitForSettings() {
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
}

function formForButton(name: string) {
  const form = screen.getByRole('button', { name }).closest('form');
  expect(form).not.toBeNull();
  return within(form!);
}

test('Settings saves provider-neutral remote access and execution configuration', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(
    <DialogProvider>
      <SettingsPage />
    </DialogProvider>,
  );
  await waitForSettings();

  const remote = formForButton('Save remote access');
  await user.click(remote.getByRole('button', { name: 'Cloudflare outer authentication' }));
  await user.click(screen.getByRole('option', { name: 'Cloudflare Access plus Aevra' }));
  await user.type(remote.getByLabelText('Access issuer'), 'https://team.cloudflareaccess.com');
  await user.type(remote.getByLabelText('Audience'), 'aud-123');
  await user.click(remote.getByRole('button', { name: 'Save remote access' }));
  await waitFor(() => {
    const call = mutationCall(fetchMock, '/api/exposure/config', 'POST');
    expect(call).toBeTruthy();
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.provider).toBe('cloudflare');
    expect(body.cloudflare.authMode).toBe('access');
    expect(body.cloudflare.issuer).toBe('https://team.cloudflareaccess.com');
    expect(body.cloudflare.audience).toBe('aud-123');
  });

  const execution = formForButton('Save execution');
  await user.click(execution.getByRole('button', { name: 'Sandbox backend' }));
  await user.click(screen.getByRole('option', { name: 'Docker' }));
  await user.click(execution.getByRole('button', { name: 'Cache policy' }));
  await user.click(screen.getByRole('option', { name: 'Shared' }));
  await user.click(execution.getByRole('button', { name: 'Advanced execution settings' }));
  const drain = execution.getByLabelText('Drain timeout (ms)');
  await user.clear(drain);
  await user.type(drain, '90000');
  await user.click(execution.getByRole('button', { name: 'Save execution' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/execution-settings', 'PATCH')).toBeTruthy(),
  );
});
test('Settings offers Native host and warns before direct computer execution', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(
    <DialogProvider>
      <SettingsPage />
    </DialogProvider>,
  );
  await waitForSettings();

  const execution = formForButton('Save execution');
  const backend = execution.getByRole('button', { name: 'Sandbox backend' });
  expect(screen.queryByText(/no container isolation/i)).not.toBeInTheDocument();

  await user.click(backend);
  expect(screen.getByRole('option', { name: 'Native host' })).toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: 'Native host' }));
  expect(screen.getByText(/no container isolation/i)).toBeInTheDocument();
  await user.click(execution.getByRole('button', { name: 'Save execution' }));

  await waitFor(() => {
    const call = mutationCall(fetchMock, '/api/execution-settings', 'PATCH');
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body)).sandboxBackend).toBe('native');
  });
});

test('Settings creates and removes command and network policy entries', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(
    <DialogProvider>
      <SettingsPage />
    </DialogProvider>,
  );
  await waitForSettings();

  await user.click(screen.getByRole('button', { name: 'Add override' }));
  const command = within(screen.getByRole('dialog', { name: 'Add command-family override' }));
  await user.type(command.getByLabelText('Family'), 'codegen');
  await user.click(command.getByRole('button', { name: 'Effect' }));
  await user.click(screen.getByRole('option', { name: 'BUILD_OUTPUT' }));
  await user.click(command.getByRole('button', { name: 'Set override' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/policy/command-families', 'PATCH')).toBeTruthy(),
  );

  const removeCommand = document.querySelector<HTMLButtonElement>(
    '[data-surface-id="settings:remove-command-family"]',
  );
  expect(removeCommand).not.toBeNull();
  await user.click(removeCommand!);
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) => input === '/api/policy/command-families' && init?.method === 'PATCH',
      ).length,
    ).toBeGreaterThanOrEqual(2),
  );

  await user.click(screen.getByRole('button', { name: 'Add rule' }));
  const network = within(screen.getByRole('dialog', { name: 'Add network rule' }));
  const host = network.getByLabelText('Host');
  await user.type(host, 'registry.example.com');
  await user.click(network.getByRole('button', { name: 'Add rule' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/policy/network-rules', 'POST')).toBeTruthy(),
  );

  const removeNetwork = document.querySelector<HTMLButtonElement>(
    '[data-surface-id="settings:remove-network-rule"]',
  );
  expect(removeNetwork).not.toBeNull();
  await user.click(removeNetwork!);
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/policy/network-rules/network-1', 'DELETE')).toBeTruthy(),
  );
});

test('Settings creates environment profiles and securely stores/removes secret references', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(
    <DialogProvider>
      <SettingsPage />
    </DialogProvider>,
  );
  await waitForSettings();

  await user.click(screen.getByRole('button', { name: 'Create profile' }));
  const profile = within(screen.getByRole('dialog', { name: 'Create environment profile' }));
  await user.type(profile.getByLabelText('Name'), 'test-profile');
  const vars = profile.getByLabelText('Variables JSON');
  fireEvent.change(vars, { target: { value: '{"NODE_ENV":"test"}' } });
  const refs = profile.getByLabelText('Secret refs JSON');
  fireEvent.change(refs, { target: { value: '{"TOKEN":"API_TOKEN"}' } });
  await user.click(profile.getByRole('button', { name: 'Create profile' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/environment-profiles', 'POST')).toBeTruthy(),
  );

  await user.click(screen.getByRole('button', { name: 'Add secret' }));
  const secret = within(screen.getByRole('dialog', { name: 'Add secret reference' }));
  await user.type(secret.getByLabelText('Reference'), 'NEW_SECRET');
  await user.type(secret.getByLabelText('Secret value'), 'super-secret');
  await user.click(secret.getByRole('button', { name: 'Store securely' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/secret-references', 'POST')).toBeTruthy(),
  );

  const removeSecret = document.querySelector<HTMLButtonElement>(
    '[data-surface-id="settings:remove-secret"]',
  );
  expect(removeSecret).not.toBeNull();
  await user.click(removeSecret!);
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/secret-references/API_TOKEN', 'DELETE')).toBeTruthy(),
  );
});

test('Guide loads chapters and copies selected-platform safe command matchers', async () => {
  const user = userEvent.setup();
  installApiFixtures();
  const writeText = vi.mocked(navigator.clipboard.writeText);
  render(<GuidePage />);

  expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: 'Safe Command Matchers' }));
  const copyAll = await screen.findByRole('button', { name: 'Copy all' });
  await user.click(copyAll);
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('git:status'));

  await user.click(screen.getByRole('button', { name: 'Linux' }));
  const individual = screen.getAllByRole('button', { name: 'Copy' })[0];
  expect(individual).toBeDefined();
  await user.click(individual!);
  expect(writeText).toHaveBeenCalledTimes(2);
});

test('Guide provides searchable responsive navigation and structured manual content', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    routes: {
      '/api/guide': [
        { slug: 'quick-start', title: 'Quick Start', file: '00-quick-start.md' },
        {
          slug: 'safe-command-matchers',
          title: 'Safe Command Matchers',
          file: '16-safe-command-matchers.md',
        },
        { slug: 'security', title: 'Security', file: '20-security.md' },
      ],
      '/manual/00-quick-start.md':
        '# Quick Start\n\n- First step\n- Second step\n\n```sh\nnpm test\n```',
    },
  });
  render(<GuidePage />);

  expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chapter' })).toBeInTheDocument();
  const chapterNav = screen.getByRole('navigation', { name: 'Manual chapters' });
  const search = within(chapterNav).getByRole('searchbox', { name: 'Search chapters' });
  await user.type(search, 'safe');
  expect(within(chapterNav).queryByRole('button', { name: 'Quick Start' })).not.toBeInTheDocument();
  expect(
    within(chapterNav).getByRole('button', { name: 'Safe Command Matchers' }),
  ).toBeInTheDocument();
  await user.clear(search);

  const list = await screen.findByRole('list', { name: 'Manual list' });
  expect(within(list).getByText('First step')).toBeInTheDocument();
  expect(screen.getByText('npm test')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Next: Safe Command Matchers' }));
  expect(await screen.findByText('git:fetch')).toBeInTheDocument();
  const pull = screen.getByText('git:pull').closest('tr');
  expect(pull).not.toBeNull();
  expect(pull).toHaveTextContent(/mutat/i);
});

test('Settings configures keep awake policy without changing screen lock behavior', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/power/keep-awake': {
        mode: 'remote-connections',
        active: true,
        supported: true,
        platform: 'win32',
        reason: '1 remote connection',
        remoteConnections: 1,
        managedProcesses: 0,
      },
    },
  });
  render(
    <DialogProvider>
      <SettingsPage />
    </DialogProvider>,
  );
  await waitForSettings();

  expect(screen.getByRole('heading', { name: 'Keep awake' })).toBeInTheDocument();
  expect(screen.getByText('1 remote connection')).toBeInTheDocument();
  expect(screen.getByLabelText('Sleep inhibition enabled')).toHaveClass('is-active');
  expect(screen.queryByText(/Active.*1 remote connection/)).not.toBeInTheDocument();
  expect(screen.getByText(/screen lock and display timeout remain unchanged/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Prevent system sleep' }));
  await user.click(screen.getByRole('option', { name: 'While Aevra is running' }));
  await user.click(screen.getByRole('button', { name: 'Save keep awake' }));

  await waitFor(() => {
    const call = mutationCall(fetchMock, '/api/power/keep-awake', 'PATCH');
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ mode: 'always' });
  });
});
