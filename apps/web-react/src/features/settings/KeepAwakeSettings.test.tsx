import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { KeepAwakeSettings } from './KeepAwakeSettings';

const status = {
  mode: 'remote-connections' as const,
  active: true,
  supported: true,
  platform: 'win32',
  reason: '1 remote connection',
  remoteConnections: 1,
  managedProcesses: 0,
};

test('save failures are shown inline and leave the form retryable', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async () => {
    throw new Error('Could not save keep awake');
  });
  render(<KeepAwakeSettings status={status} onSave={onSave} />);

  await user.click(screen.getByRole('button', { name: 'Save keep awake' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save keep awake');
  expect(screen.getByRole('button', { name: 'Save keep awake' })).toBeEnabled();
});

test('save is single-flight while a request is pending', async () => {
  const user = userEvent.setup();
  let resolveSave!: () => void;
  const onSave = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  render(<KeepAwakeSettings status={status} onSave={onSave} />);

  const save = screen.getByRole('button', { name: 'Save keep awake' });
  await user.click(save);
  expect(save).toBeDisabled();
  await user.click(save);
  expect(onSave).toHaveBeenCalledTimes(1);

  resolveSave();
  await waitFor(() => expect(save).toBeEnabled());
});
