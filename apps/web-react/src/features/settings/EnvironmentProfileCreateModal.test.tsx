import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { EnvironmentProfileCreateModal } from './EnvironmentProfileCreateModal';

const postJson = vi.fn();

vi.mock('./settings-service', () => ({
  postJson: (path: string, value: unknown) => postJson(path, value),
}));

beforeEach(() => {
  postJson.mockReset();
});

test('submits successfully and tolerates refresh failure', async () => {
  postJson.mockResolvedValue(undefined);
  const onClose = vi.fn();
  const onCreated = vi.fn().mockRejectedValue(new Error('refresh failed'));
  const user = userEvent.setup();

  render(<EnvironmentProfileCreateModal onClose={onClose} onCreated={onCreated} />);

  const dialog = screen.getByRole('dialog', { name: 'Create environment profile' });
  await user.type(within(dialog).getByLabelText('Name'), 'staging');
  fireEvent.change(within(dialog).getByLabelText('Variables JSON'), {
    target: { value: '{"ENV":"staging"}' },
  });
  fireEvent.change(within(dialog).getByLabelText('Secret refs JSON'), {
    target: { value: '{"SECRET":"KEY"}' },
  });
  await user.click(within(dialog).getByRole('button', { name: 'Create profile' }));

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(postJson).toHaveBeenCalledWith('/api/environment-profiles', {
    name: 'staging',
    vars: { ENV: 'staging' },
    secretRefs: { SECRET: 'KEY' },
  });
  expect(onCreated).toHaveBeenCalledOnce();
});

test.each([
  ['array vars', '[1,2]', '{}'],
  ['array secretRefs', '{}', '[1,2]'],
  ['primitive string vars', '"hello"', '{}'],
  ['invalid JSON syntax', '{bad', '{}'],
])('rejects invalid JSON structures: %s', async (_, vars, secretRefs) => {
  const user = userEvent.setup();
  render(<EnvironmentProfileCreateModal onClose={vi.fn()} onCreated={vi.fn()} />);

  const dialog = screen.getByRole('dialog', { name: 'Create environment profile' });
  await user.type(within(dialog).getByLabelText('Name'), 'invalid-test');
  fireEvent.change(within(dialog).getByLabelText('Variables JSON'), {
    target: { value: vars },
  });
  fireEvent.change(within(dialog).getByLabelText('Secret refs JSON'), {
    target: { value: secretRefs },
  });
  await user.click(within(dialog).getByRole('button', { name: 'Create profile' }));

  expect(
    await within(dialog).findByText('Variables and secret references must be valid JSON objects.'),
  ).toBeInTheDocument();
  expect(postJson).not.toHaveBeenCalled();
});

test('displays server error when creation fails', async () => {
  postJson.mockRejectedValue(new Error('Profile name duplicate'));
  const user = userEvent.setup();
  const onClose = vi.fn();

  render(<EnvironmentProfileCreateModal onClose={onClose} onCreated={vi.fn()} />);

  const dialog = screen.getByRole('dialog', { name: 'Create environment profile' });
  await user.type(within(dialog).getByLabelText('Name'), 'dup-profile');
  await user.click(within(dialog).getByRole('button', { name: 'Create profile' }));

  expect(await within(dialog).findByText('Profile name duplicate')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});
