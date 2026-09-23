import type { McpActivityEntry } from '@aevra/admin-contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { DialogProvider, useDialog } from '../../components/Dialog';
import { showMcpActivityDetails } from './activity-detail';

const input = JSON.stringify({ commands: [{ executable: 'npm', args: ['test'] }] }, null, 2);
const output = JSON.stringify(
  {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          results: [{ index: 0, ok: true, value: { exitCode: 0, stdout: 'all good' } }],
        }),
      },
    ],
  },
  null,
  2,
);

const entry: McpActivityEntry = {
  id: 'op_1',
  startedAt: '2026-09-23T03:00:00.000Z',
  updatedAt: '2026-09-23T03:00:01.250Z',
  actor: 'oauth:Claude',
  sessionId: 'ses_1',
  workspaceId: 'ws_1',
  kind: 'tool',
  action: 'command_run_many',
  state: 'success',
  durationMs: 1250,
  input,
  output,
};

function Opener() {
  const dialog = useDialog();
  return (
    <button
      type="button"
      onClick={() => void showMcpActivityDetails(dialog, entry, [{ id: 'ws_1', name: 'Aevra' }])}
    >
      Open
    </button>
  );
}

async function openDetails() {
  const user = userEvent.setup();
  render(
    <DialogProvider>
      <Opener />
    </DialogProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return { user, dialog: screen.getByRole('dialog') };
}

afterEach(() => {
  localStorage.clear();
});

test('activity details open wide with input and output side by side', async () => {
  const { dialog } = await openDetails();
  expect(dialog).toHaveClass('wide');
  const columns = dialog.querySelector('.activity-detail-columns');
  expect(columns?.children).toHaveLength(2);
  expect(within(dialog).getByRole('heading', { name: 'Input' })).toBeInTheDocument();
  expect(within(dialog).getByRole('heading', { name: 'Output' })).toBeInTheDocument();
  expect(within(dialog).getByTestId('command-line')).toHaveTextContent('npm test');
  expect(within(dialog).getByText('exit 0')).toBeInTheDocument();
  expect(within(dialog).getByText('all good')).toBeInTheDocument();
});

test('activity details summarize the call in the header', async () => {
  const { dialog } = await openDetails();
  const meta = dialog.querySelector('.activity-detail-meta') as HTMLElement;
  expect(within(meta).getByText('command_run_many')).toBeInTheDocument();
  expect(within(meta).getByText('Claude')).toBeInTheDocument();
  expect(within(meta).getByText('Aevra')).toBeInTheDocument();
  expect(within(meta).getByText('SUCCESS')).toBeInTheDocument();
  expect(within(meta).getByText('1.25 s')).toBeInTheDocument();
});

test('raw toggle switches both columns to the exact recorded text', async () => {
  const { user, dialog } = await openDetails();
  await user.click(within(dialog).getByRole('button', { name: 'Raw' }));
  const raws = within(dialog).getAllByTestId('json-detail-raw');
  expect(raws).toHaveLength(2);
  expect(raws[0]!.textContent).toBe(input);
  expect(raws[1]!.textContent).toBe(output);
  expect(within(dialog).queryByTestId('command-line')).not.toBeInTheDocument();
});
