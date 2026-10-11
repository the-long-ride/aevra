import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { SecretReferencesSettings } from './SecretReferencesSettings';

const postJson = vi.fn();
const deleteResource = vi.fn();

vi.mock('./settings-service', () => ({
  postJson: (path: string, value: unknown) => postJson(path, value),
  deleteResource: (path: string) => deleteResource(path),
}));

beforeEach(() => {
  postJson.mockReset();
  deleteResource.mockReset();
});

function mount(
  secretRefs: Array<Record<string, unknown> | string>,
  onChanged = vi.fn().mockResolvedValue(undefined),
) {
  render(
    <DialogProvider>
      <SecretReferencesSettings secretRefs={secretRefs} onChanged={onChanged} />
    </DialogProvider>,
  );
  return { onChanged };
}

test('secret references normalize string, ref, key, and empty record shapes', () => {
  mount(['STRING_REF', { ref: 'OBJECT_REF' }, { key: 'KEY_REF' }, {}]);

  expect(screen.getByText('4 locally stored references.')).toBeInTheDocument();
  expect(screen.getByText('STRING_REF')).toBeInTheDocument();
  expect(screen.getByText('OBJECT_REF')).toBeInTheDocument();
  expect(screen.getByText('KEY_REF')).toBeInTheDocument();
  expect(screen.getAllByText('Configured')).toHaveLength(4);
});

test('secret references show the name from the list endpoint shape', () => {
  mount([
    { id: 'DEPLOY_NAME', backend: 'selected', keyRef: 'DEPLOY_NAME' },
    { keyRef: 'KEY_REF_ONLY' },
  ]);

  expect(screen.getByText('DEPLOY_NAME')).toBeInTheDocument();
  expect(screen.getByText('KEY_REF_ONLY')).toBeInTheDocument();
});

test('edit replaces only the value of an existing reference and confirms with a toast', async () => {
  postJson.mockResolvedValue(undefined);
  const user = userEvent.setup();
  const { onChanged } = mount([{ id: 'API_NAME' }]);

  await user.click(screen.getByRole('button', { name: 'Edit API_NAME' }));
  const modal = screen.getByRole('dialog', { name: 'Update secret value' });
  const reference = within(modal).getByLabelText('Reference');
  expect(reference).toHaveValue('API_NAME');
  expect(reference).toHaveAttribute('readonly');
  await user.type(within(modal).getByLabelText('Secret value'), 'replacement phrase');
  await user.click(within(modal).getByRole('button', { name: 'Update secret' }));

  await waitFor(() =>
    expect(postJson).toHaveBeenCalledWith('/api/secret-references', {
      ref: 'API_NAME',
      value: 'replacement phrase',
    }),
  );
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Secret value for "API_NAME" updated.',
  );
  expect(onChanged).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('adding a reference confirms with a toast', async () => {
  postJson.mockResolvedValue(undefined);
  const user = userEvent.setup();
  mount([]);

  await user.click(screen.getByRole('button', { name: 'Add secret' }));
  const modal = screen.getByRole('dialog', { name: 'Add secret reference' });
  await user.type(within(modal).getByLabelText('Reference'), 'NEW_NAME');
  await user.type(within(modal).getByLabelText('Secret value'), 'fresh phrase');
  await user.click(within(modal).getByRole('button', { name: 'Store securely' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Secret reference stored.');
});

test('deleting a reference reports success and failure as toasts', async () => {
  deleteResource.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('store offline'));
  const user = userEvent.setup();
  const { onChanged } = mount([{ id: 'API_NAME' }]);

  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Secret reference "API_NAME" deleted.',
  );
  expect(onChanged).toHaveBeenCalledOnce();

  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('store offline');
  expect(onChanged).toHaveBeenCalledOnce();
});
