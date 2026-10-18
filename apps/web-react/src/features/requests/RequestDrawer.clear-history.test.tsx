import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { RequestDrawer } from './RequestDrawer';

const finished = (id: string, state: string) => ({
  id,
  state,
  actor: 'ChatGPT',
  risk: 'LOW',
  workspaceId: 'ws-1',
  operation: { family: 'git:status', capability: 'commands.run' },
});

function deleteCalls(fetchMock: ReturnType<typeof installApiFixtures>) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    return url === '/api/approvals/history' && String(init?.method).toUpperCase() === 'DELETE';
  });
}

function renderDrawer() {
  render(
    <DialogProvider>
      <RequestDrawer open onClose={() => undefined} onPendingCountChange={vi.fn()} />
    </DialogProvider>,
  );
}

function clearButton() {
  return document.querySelector<HTMLButtonElement>('[data-surface-id="requests:clear-history"]');
}

test('clear history button is disabled when there is no history', async () => {
  const user = userEvent.setup();
  installApiFixtures({ approvals: [] });
  renderDrawer();
  await screen.findByText('No pending requests');
  await user.click(screen.getByRole('button', { name: /History/ }));
  expect(clearButton()).not.toBeNull();
  expect(clearButton()).toBeDisabled();
  expect(clearButton()).toHaveClass('danger-button');
});

test('confirming clear history calls DELETE, refreshes and toasts the count', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    approvals: [finished('a1', 'DENIED'), finished('a2', 'SUCCEEDED')],
    mutationResponses: { 'DELETE /api/approvals/history': { deleted: 2 } },
  });
  renderDrawer();
  await screen.findByText('No pending requests');
  await user.click(screen.getByRole('button', { name: /History/ }));
  await waitFor(() => expect(clearButton()).toBeEnabled());
  const loadsBefore = fetchMock.mock.calls.filter(([input]) => input === '/api/approvals').length;

  await user.click(clearButton()!);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Clear approval history?')).toBeInTheDocument();
  expect(dialog.textContent).toContain(
    'Permanently removes 2 finished approvals, including requests that timed out. Pending requests and approved requests that have not run yet are kept. The audit log is not affected.',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Clear history' }));

  await waitFor(() => expect(deleteCalls(fetchMock)).toHaveLength(1));
  expect(await screen.findByText('Cleared 2 approvals')).toBeInTheDocument();
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([input]) => input === '/api/approvals').length,
    ).toBeGreaterThan(loadsBefore),
  );
});

test('cancelling the clear history dialog makes no request', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({ approvals: [finished('a1', 'DENIED')] });
  renderDrawer();
  await screen.findByText('No pending requests');
  await user.click(screen.getByRole('button', { name: /History/ }));
  await waitFor(() => expect(clearButton()).toBeEnabled());

  await user.click(clearButton()!);
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(deleteCalls(fetchMock)).toHaveLength(0);
});

test('clear history counts only rows that will be deleted', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    approvals: [finished('a1', 'DENIED'), finished('a2', 'APPROVED'), finished('a3', 'EXECUTING')],
  });
  renderDrawer();
  await screen.findByText('No pending requests');
  await user.click(screen.getByRole('button', { name: /History/ }));
  await waitFor(() => expect(clearButton()).toBeEnabled());
  await user.click(clearButton()!);
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain(
    'Permanently removes 1 finished approvals, including requests that timed out. Pending requests and approved requests that have not run yet are kept. The audit log is not affected.',
  );
});

test('clear history is disabled when only approved or executing rows exist', async () => {
  const user = userEvent.setup();
  installApiFixtures({ approvals: [finished('a2', 'APPROVED'), finished('a3', 'EXECUTING')] });
  renderDrawer();
  await screen.findByText('No pending requests');
  await user.click(screen.getByRole('button', { name: /History/ }));
  expect(clearButton()).toBeDisabled();
});
