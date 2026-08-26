import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { SettingsPage } from './SettingsPage';

function mutationCall(
  fetchMock: ReturnType<typeof installApiFixtures>,
  path: string,
  method: string,
) {
  return fetchMock.mock.calls.find(
    ([input, init]) => input === path && String(init?.method ?? 'GET').toUpperCase() === method,
  );
}

async function renderSettings() {
  const fetchMock = installApiFixtures({
    routes: {
      '/api/policy/command-families': { 'git:status': 'READ_ONLY' },
      '/api/policy/network-rules': [
        { id: 'network-1', effect: 'allow', protocol: 'https', host: 'api.example.com', port: 443 },
      ],
      '/api/environment-profiles': [{ name: 'dev', vars: {}, secretRefs: {} }],
      '/api/secret-references': [{ ref: 'API_TOKEN' }],
    },
  });
  render(<SettingsPage />);
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  return fetchMock;
}

test('creation controls stay compact and open dedicated dialogs', async () => {
  await renderSettings();
  const user = userEvent.setup();

  for (const [buttonName, dialogName] of [
    ['Add override', 'Add command-family override'],
    ['Add rule', 'Add network rule'],
    ['Create profile', 'Create environment profile'],
    ['Add secret', 'Add secret reference'],
  ] as const) {
    const button = screen.getByRole('button', { name: buttonName });
    expect(button.closest('form')).toBeNull();
    await user.click(button);
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument();
  }
});

test('environment profile modal validates JSON and posts parsed values', async () => {
  const fetchMock = await renderSettings();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Create profile' }));
  const dialog = screen.getByRole('dialog', { name: 'Create environment profile' });
  await user.type(within(dialog).getByLabelText('Name'), 'test-profile');
  fireEvent.change(within(dialog).getByLabelText('Variables JSON'), {
    target: { value: '{bad' },
  });
  await user.click(within(dialog).getByRole('button', { name: 'Create profile' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('valid JSON');
  expect(mutationCall(fetchMock, '/api/environment-profiles', 'POST')).toBeUndefined();

  fireEvent.change(within(dialog).getByLabelText('Variables JSON'), {
    target: { value: '{"NODE_ENV":"test"}' },
  });
  fireEvent.change(within(dialog).getByLabelText('Secret refs JSON'), {
    target: { value: '{"TOKEN":"API_TOKEN"}' },
  });
  await user.click(within(dialog).getByRole('button', { name: 'Create profile' }));
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/environment-profiles', 'POST')).toBeTruthy(),
  );
  const call = mutationCall(fetchMock, '/api/environment-profiles', 'POST');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({
    name: 'test-profile',
    vars: { NODE_ENV: 'test' },
    secretRefs: { TOKEN: 'API_TOKEN' },
  });
  expect(
    screen.queryByRole('dialog', { name: 'Create environment profile' }),
  ).not.toBeInTheDocument();
});

test('secret modal clears secret values after closing', async () => {
  await renderSettings();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add secret' }));
  let dialog = screen.getByRole('dialog', { name: 'Add secret reference' });
  await user.type(within(dialog).getByLabelText('Reference'), 'TEMP_SECRET');
  await user.type(within(dialog).getByLabelText('Secret value'), 'sensitive-value');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

  await user.click(screen.getByRole('button', { name: 'Add secret' }));
  dialog = screen.getByRole('dialog', { name: 'Add secret reference' });
  expect(within(dialog).getByLabelText('Reference')).toHaveValue('');
  expect(within(dialog).getByLabelText('Secret value')).toHaveValue('');
});

test('advanced execution settings are collapsed and keep awake uses compact controls', async () => {
  await renderSettings();
  expect(screen.queryByLabelText('Drain timeout (ms)')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Parallel search values (N)')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Advanced execution settings' })).toBeInTheDocument();

  const keepAwake = screen.getByRole('region', { name: 'Keep awake' });
  expect(keepAwake).toHaveClass('compact-settings-panel');
  expect(
    within(keepAwake).getByRole('button', { name: 'Prevent system sleep' }),
  ).toBeInTheDocument();
});
