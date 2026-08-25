import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import type { HookSetting } from './settings-service';
import { HooksSettings } from './HooksSettings';

const existingHooks: HookSetting[] = [
  {
    id: 'hook-1',
    name: 'Audit tool calls',
    event: 'after_tool_call',
    enabled: true,
    kind: 'command',
    execution: 'run',
    executable: '/usr/local/bin/audit',
    args: ['--json'],
    env: { LOG_LEVEL: 'info' },
    permissions: ['observe', 'block'],
    timeoutMs: 5000,
    failurePolicy: 'continue',
  },
  {
    id: 'hook-2',
    name: 'Paused hook',
    event: 'session_start',
    enabled: false,
    kind: 'command',
    execution: 'launch',
    executable: 'notifier',
    args: [],
    permissions: [],
    timeoutMs: 2500,
    failurePolicy: 'block',
  },
];

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

function renderHooks(hooks: HookSetting[], onChanged = vi.fn(async () => undefined)) {
  render(
    <DialogProvider>
      <HooksSettings hooks={hooks} onChanged={onChanged} />
    </DialogProvider>,
  );
  return onChanged;
}

test('hook creation fields open in a modal and use shared switches', async () => {
  const user = userEvent.setup();
  renderHooks([]);

  expect(screen.queryByRole('dialog', { name: 'Create lifecycle hook' })).toBeNull();
  expect(screen.queryByRole('switch', { name: 'Block' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Add hook' }));

  const dialog = screen.getByRole('dialog', { name: 'Create lifecycle hook' });
  expect(within(dialog).getByRole('switch', { name: 'Block' })).toBeInTheDocument();
  expect(within(dialog).getByRole('switch', { name: 'Modify prompt' })).toBeInTheDocument();
  expect(within(dialog).getByRole('switch', { name: 'Enabled' })).toBeChecked();
  expect(dialog.querySelector('.hook-form-main')).not.toBeNull();
  expect(dialog.querySelector('.hook-permission-grid')).not.toBeNull();
});

test('hook creation modal closes with Escape and resets fields when reopened', async () => {
  const user = userEvent.setup();
  renderHooks([]);

  await user.click(screen.getByRole('button', { name: 'Add hook' }));
  await user.type(screen.getByLabelText('Name'), 'Temporary hook');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Create lifecycle hook' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Add hook' }));
  expect(screen.getByLabelText('Name')).toHaveValue('');
});

test('adding a hook posts the parsed modal payload with selected mutation permissions', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const onChanged = vi.fn(async () => undefined);
  renderHooks([], onChanged);

  await user.click(screen.getByRole('button', { name: 'Add hook' }));
  await user.type(screen.getByLabelText('Name'), 'Guard writes');
  await user.type(screen.getByLabelText('Executable / app'), 'guard.exe');
  fireEvent.change(screen.getByLabelText('Arguments JSON'), {
    target: { value: '["--strict"]' },
  });
  fireEvent.change(screen.getByLabelText('Environment JSON'), {
    target: { value: '{"MODE":"safe"}' },
  });
  await user.click(screen.getByRole('switch', { name: 'Modify prompt' }));
  await user.click(screen.getByRole('switch', { name: 'Block' }));
  await user.click(screen.getByRole('button', { name: 'Create hook' }));

  await waitFor(() => expect(mutationCall(fetchMock, '/api/hooks', 'POST')).toBeTruthy());
  const call = mutationCall(fetchMock, '/api/hooks', 'POST');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({
    name: 'Guard writes',
    event: 'before_tool_call',
    kind: 'command',
    execution: 'run',
    executable: 'guard.exe',
    args: ['--strict'],
    env: { MODE: 'safe' },
    permissions: ['observe', 'block', 'modifyPrompt'],
    timeoutMs: 5000,
    failurePolicy: 'continue',
    enabled: true,
  });
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog', { name: 'Create lifecycle hook' })).toBeNull();
});

test('invalid hook JSON stays in the modal and shows a validation error', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  renderHooks([]);

  await user.click(screen.getByRole('button', { name: 'Add hook' }));
  await user.type(screen.getByLabelText('Name'), 'Bad hook');
  await user.type(screen.getByLabelText('Executable / app'), 'bad.exe');
  fireEvent.change(screen.getByLabelText('Arguments JSON'), { target: { value: '[' } });
  await user.click(screen.getByRole('button', { name: 'Create hook' }));

  expect(
    await screen.findByText('Hook arguments/environment must be valid JSON'),
  ).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Create lifecycle hook' })).toBeInTheDocument();
  expect(mutationCall(fetchMock, '/api/hooks', 'POST')).toBeUndefined();
});

test('hook creation cannot be dismissed while the create request is pending', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  let resolveRequest!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
  );
  renderHooks([]);

  await user.click(screen.getByRole('button', { name: 'Add hook' }));
  await user.type(screen.getByLabelText('Name'), 'Slow hook');
  await user.type(screen.getByLabelText('Executable / app'), 'slow.exe');
  await user.click(screen.getByRole('button', { name: 'Create hook' }));

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Create lifecycle hook' })).toBeInTheDocument();

  resolveRequest(
    new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Create lifecycle hook' })).toBeNull(),
  );
});

test('refresh failure after successful hook creation does not leave a duplicate-submit form open', async () => {
  const user = userEvent.setup();
  installApiFixtures();
  renderHooks(
    [],
    vi.fn(async () => Promise.reject(new Error('refresh failed'))),
  );

  await user.click(screen.getByRole('button', { name: 'Add hook' }));
  await user.type(screen.getByLabelText('Name'), 'Created hook');
  await user.type(screen.getByLabelText('Executable / app'), 'created.exe');
  await user.click(screen.getByRole('button', { name: 'Create hook' }));

  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Create lifecycle hook' })).toBeNull(),
  );
});

test('hook table enables disables and deletes hooks through mutations', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const onChanged = vi.fn(async () => undefined);
  renderHooks(existingHooks, onChanged);

  const table = document.querySelector<HTMLElement>('[data-table-id="react-hooks"]');
  expect(table).not.toBeNull();

  await user.click(within(table!).getByRole('button', { name: 'Disable' }));
  await waitFor(() => expect(mutationCall(fetchMock, '/api/hooks/hook-1', 'PATCH')).toBeTruthy());
  const patch = mutationCall(fetchMock, '/api/hooks/hook-1', 'PATCH');
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ enabled: false });

  await user.click(within(table!).getByRole('button', { name: 'Enable' }));
  await waitFor(() => expect(mutationCall(fetchMock, '/api/hooks/hook-2', 'PATCH')).toBeTruthy());

  const pausedRow = within(table!).getByText('Paused hook').closest('tr') as HTMLElement;
  await user.click(within(pausedRow).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(mutationCall(fetchMock, '/api/hooks/hook-2', 'DELETE')).toBeTruthy());
  expect(onChanged).toHaveBeenCalledTimes(3);
});

test('hook table falls back to observe and block copy when a hook has no extra permissions', () => {
  renderHooks(existingHooks);
  const table = document.querySelector<HTMLElement>('[data-table-id="react-hooks"]');
  expect(within(table!).getAllByText('observe, block')).toHaveLength(2);
  expect(within(table!).getByText('Yes')).toBeInTheDocument();
  expect(within(table!).getByText('No')).toBeInTheDocument();
});
