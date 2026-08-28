import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { SecretReferenceCreateModal } from './SecretReferenceCreateModal';

const postJson = vi.fn();

vi.mock('./settings-service', () => ({
  postJson: (path: string, value: unknown) => postJson(path, value),
}));

beforeEach(() => postJson.mockReset());

test('secret creation closes after storage and tolerates refresh failure', async () => {
  postJson.mockResolvedValue(undefined);
  const onClose = vi.fn();
  const onCreated = vi.fn().mockRejectedValue(new Error('refresh failed'));
  const user = userEvent.setup();
  render(<SecretReferenceCreateModal onClose={onClose} onCreated={onCreated} />);

  const dialog = screen.getByRole('dialog', { name: 'Add secret reference' });
  await user.type(within(dialog).getByLabelText('Reference'), 'DEPLOY_TOKEN');
  await user.type(within(dialog).getByLabelText('Secret value'), 'secret-value');
  await user.click(within(dialog).getByRole('button', { name: 'Store securely' }));

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(postJson).toHaveBeenCalledWith('/api/secret-references', {
    ref: 'DEPLOY_TOKEN',
    value: 'secret-value',
  });
  expect(onCreated).toHaveBeenCalledOnce();
});

test.each([
  [new Error('secure store failed'), 'secure store failed'],
  ['storage unavailable', 'storage unavailable'],
])('secret creation reports storage failures without closing: %s', async (cause, message) => {
  postJson.mockRejectedValue(cause);
  const onClose = vi.fn();
  const onCreated = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<SecretReferenceCreateModal onClose={onClose} onCreated={onCreated} />);

  const dialog = screen.getByRole('dialog', { name: 'Add secret reference' });
  await user.type(within(dialog).getByLabelText('Reference'), 'DEPLOY_TOKEN');
  await user.type(within(dialog).getByLabelText('Secret value'), 'secret-value');
  await user.click(within(dialog).getByRole('button', { name: 'Store securely' }));

  expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
  expect(onClose).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('button', { name: 'Store securely' })).toBeEnabled();
});
