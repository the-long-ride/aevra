import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
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
  expect(
    await screen.findByRole('heading', { name: 'Settings' }),
  ).toBeInTheDocument();
}

function formForButton(name: string) {
  const form = screen.getByRole('button', { name }).closest('form');
  expect(form).not.toBeNull();
  return within(form!);
}

test('Settings saves Access and execution configuration', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(<SettingsPage />);
  await waitForSettings();

  const access = formForButton('Save Access mode');
  await user.selectOptions(access.getByLabelText('Mode'), 'access');
  await user.type(
    access.getByLabelText('Access issuer'),
    'https://team.cloudflareaccess.com',
  );
  await user.type(access.getByLabelText('Audience'), 'aud-123');
  await user.click(access.getByRole('button', { name: 'Save Access mode' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/cloudflare/setup', 'POST')).toBeTruthy(),
  );

  const execution = formForButton('Save');
  await user.selectOptions(execution.getByLabelText('Sandbox backend'), 'docker');
  await user.selectOptions(execution.getByLabelText('Cache policy'), 'shared');
  const drain = execution.getByLabelText('Drain timeout (ms)');
  await user.clear(drain);
  await user.type(drain, '90000');
  await user.click(execution.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/execution-settings', 'PATCH')).toBeTruthy(),
  );
});

test('Settings offers Native host and warns before direct computer execution', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(<SettingsPage />);
  await waitForSettings();

  const execution = formForButton('Save');
  const backend = execution.getByLabelText('Sandbox backend');
  expect(within(backend).getByRole('option', { name: 'Native host' })).toHaveValue('native');
  expect(screen.queryByText(/no container isolation/i)).not.toBeInTheDocument();

  await user.selectOptions(backend, 'native');
  expect(screen.getByText(/no container isolation/i)).toBeInTheDocument();
  await user.click(execution.getByRole('button', { name: 'Save' }));

  await waitFor(() => {
    const call = mutationCall(fetchMock, '/api/execution-settings', 'PATCH');
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body)).sandboxBackend).toBe('native');
  });
});

test('Settings creates and removes command and network policy entries', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(<SettingsPage />);
  await waitForSettings();

  const command = formForButton('Set override');
  await user.type(command.getByLabelText('Family'), 'codegen');
  await user.selectOptions(command.getByLabelText('Effect'), 'BUILD_OUTPUT');
  await user.click(command.getByRole('button', { name: 'Set override' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/policy/command-families', 'PATCH'),
    ).toBeTruthy(),
  );

  const removeCommand = document.querySelector<HTMLButtonElement>(
    '[data-surface-id="settings:remove-command-family"]',
  );
  expect(removeCommand).not.toBeNull();
  await user.click(removeCommand!);
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([input, init]) =>
        input === '/api/policy/command-families' && init?.method === 'PATCH',
      ).length,
    ).toBeGreaterThanOrEqual(2),
  );

  const network = formForButton('Add rule');
  const host = network.getByLabelText('Host');
  await user.clear(host);
  await user.type(host, 'registry.example.com');
  await user.click(network.getByRole('button', { name: 'Add rule' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/policy/network-rules', 'POST'),
    ).toBeTruthy(),
  );

  const removeNetwork = document.querySelector<HTMLButtonElement>(
    '[data-surface-id="settings:remove-network-rule"]',
  );
  expect(removeNetwork).not.toBeNull();
  await user.click(removeNetwork!);
  await waitFor(() =>
    expect(
      mutationCall(
        fetchMock,
        '/api/policy/network-rules/network-1',
        'DELETE',
      ),
    ).toBeTruthy(),
  );
});

test('Settings creates environment profiles and securely stores/removes secret references', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(<SettingsPage />);
  await waitForSettings();

  const profile = formForButton('Create profile');
  await user.type(profile.getByLabelText('Name'), 'test-profile');
  const vars = profile.getByLabelText('Variables JSON');
  await user.clear(vars);
  await user.type(vars, '{"NODE_ENV":"test"}');
  const refs = profile.getByLabelText('Secret refs JSON');
  await user.clear(refs);
  await user.type(refs, '{"TOKEN":"API_TOKEN"}');
  await user.click(profile.getByRole('button', { name: 'Create profile' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/environment-profiles', 'POST'),
    ).toBeTruthy(),
  );

  const secret = formForButton('Store securely');
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
    expect(
      mutationCall(fetchMock, '/api/secret-references/API_TOKEN', 'DELETE'),
    ).toBeTruthy(),
  );
});

test('Guide loads chapters and copies selected-platform safe command matchers', async () => {
  const user = userEvent.setup();
  installApiFixtures();
  const writeText = vi.mocked(navigator.clipboard.writeText);
  render(<GuidePage />);

  expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
  await user.click(
    await screen.findByRole('button', { name: 'Safe Command Matchers' }),
  );
  const copyAll = await screen.findByRole('button', { name: 'Copy all' });
  await user.click(copyAll);
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('git:status'));

  await user.click(screen.getByRole('button', { name: 'Linux' }));
  const individual = screen.getAllByRole('button', { name: 'Copy' })[0];
  expect(individual).toBeDefined();
  await user.click(individual!);
  expect(writeText).toHaveBeenCalledTimes(2);
});
