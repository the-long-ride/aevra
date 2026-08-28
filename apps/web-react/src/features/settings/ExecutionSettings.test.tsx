import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { ExecutionSettings } from './ExecutionSettings';

test('Execution settings submits safe defaults while advanced controls stay collapsed', async () => {
  const fetchMock = installApiFixtures();
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();

  render(<ExecutionSettings execution={{}} onChanged={onChanged} />);

  expect(screen.queryByLabelText('Drain timeout (ms)')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Parallel search values (N)')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save execution' }));

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(
      ([input, init]) => input === '/api/execution-settings' && init?.method === 'PATCH',
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      sandboxBackend: 'auto',
      cachePolicy: 'workspace',
      workspaceDrainMs: 60000,
      searchMaxQueries: 8,
    });
  });
  expect(onChanged).toHaveBeenCalledOnce();
});
