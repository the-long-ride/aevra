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

test('adding a hook posts the parsed form payload with selected mutation permissions', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const onChanged = vi.fn(async () => undefined);
  renderHooks([], onChanged);

  await user.type(screen.getByLabelText('Name'), 'Guard writes');
  await user.type(screen.getByLabelText('Executable / app'), 'guard.exe');
  // JSON payloads contain characters the keyboard parser reserves, so set them directly.
  fireEvent.change(screen.getByLabelText('Arguments JSON'), {
    target: { value: '["--strict"]' },
  });
  fireEvent.change(screen.getByLabelText('Environment JSON'), {
    target: { value: '{"MODE":"safe"}' },
  });
  await user.click(screen.getByRole('checkbox', { name: 'Modify prompt' }));
  await user.click(screen.getByRole('checkbox', { name: 'Block' }));
  await user.click(screen.getByRole('button', { name: 'Add hook' }));

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
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
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
