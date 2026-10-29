import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { FileTransferSettings } from './FileTransferSettings';

test('File transfer settings loads limits and submits numbers', async () => {
  const fetchMock = installApiFixtures({
    routes: { '/api/files/transfer-settings': { maxFileMb: 200, maxBatchMb: 500, inlineMb: 50 } },
  });
  const user = userEvent.setup();
  render(<FileTransferSettings />);

  const file = await screen.findByLabelText('Max file size (MB)');
  expect(file).toHaveValue(200);
  expect(screen.getByLabelText('Max batch size (MB)')).toHaveValue(500);
  expect(screen.getByLabelText('Max inline size (MB)')).toHaveValue(50);
  expect(screen.getByLabelText('Max inline size (MB)')).toHaveAttribute('max', '256');

  await user.clear(file);
  await user.type(file, '120');
  await user.click(screen.getByRole('button', { name: 'Save transfer limits' }));

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(
      ([input, init]) => input === '/api/files/transfer-settings' && init?.method === 'PATCH',
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      maxFileMb: 120,
      maxBatchMb: 500,
      inlineMb: 50,
    });
  });
});

test('File transfer settings shows a load failure', async () => {
  installApiFixtures();
  render(<FileTransferSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load transfer limits');
});
