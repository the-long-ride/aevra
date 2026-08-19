import { render, screen, waitFor } from '@testing-library/react';
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

test('Settings saves Access and execution configuration', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(<SettingsPage />);
  await waitForSettings();

  await user.selectOptions(screen.getByLabelText('Mode'), 'access');
  await user.type(
    screen.getByLabelText('Access issuer'),
    'https://team.cloudflareaccess.com',
  );
  await user.type(screen.getByLabelText('Audience'), 'aud-123');
  await user.click(screen.getByRole('button', { name: 'Save Access mode' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/cloudflare/setup', 'POST')).toBeTruthy(),
  );

  await waitForSettings();
  await user.selectOptions(screen.getByLabelText('Sandbox backend'), 'docker');
  await user.selectOptions(screen.getByLabelText('Cache policy'), 'shared');
  const drain = screen.getByLabelText('Drain timeout (ms)');
  await user.clear(drain);
  await user.type(drain, '90000');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/execution-settings', 'PATCH')).toBeTruthy(),
  );
});

test('Settings creates and removes command and network policy entries', async () => {
  const user = userEvent.setup();
  const fetchMock = settingsFixtures();
  render(<SettingsPage />);
  await waitForSettings();

  await user.type(screen.getByLabelText('Family'), 'codegen');
  await user.selectOptions(screen.getByLabelText('Effect'), 'BUILD_OUTPUT');
  await user.click(screen.getByRole('button', { name: 'Set override' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/policy/command-families', 'PATCH'),
    ).toBeTruthy(),
  );

  await waitForSettings();
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

  await waitForSettings();
  const host = screen.getByLabelText('Host');
  await user.clear(host);
  await user.type(host, 'registry.example.com');
  await user.click(screen.getByRole('button', { name: 'Add rule' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/policy/network-rules', 'POST'),
    ).toBeTruthy(),
  );

  await waitForSettings();
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

  const profileName = screen.getByLabelText('Name');
  await user.type(profileName, 'test-profile');
  const vars = screen.getByLabelText('Variables JSON');
  await user.clear(vars);
  await user.type(vars, '{"NODE_ENV":"test"}');
  const refs = screen.getByLabelText('Secret refs JSON');
  await user.clear(refs);
  await user.type(refs, '{"TOKEN":"API_TOKEN"}');
  await user.click(screen.getByRole('button', { name: 'Create profile' }));
  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/environment-profiles', 'POST'),
    ).toBeTruthy(),
  );

  await waitForSettings();
  await user.type(screen.getByLabelText('Reference'), 'NEW_SECRET');
  await user.type(screen.getByLabelText('Secret value'), 'super-secret');
  await user.click(screen.getByRole('button', { name: 'Store securely' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/secret-references', 'POST')).toBeTruthy(),
  );

  await waitForSettings();
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
