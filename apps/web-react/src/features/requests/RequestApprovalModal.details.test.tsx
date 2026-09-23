import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { approvalCommands } from './ApprovalPayloadPanel';
import { RequestApprovalModal } from './RequestApprovalModal';
import type { RequestsData } from './requests-service';

const analysis = {
  version: 1,
  requestFingerprint: 'request',
  context: {},
  parseStatus: 'parsed',
  scope: 'in-scope',
  nodes: [],
  edges: [],
  reasons: [],
  evidenceFingerprint: 'evidence',
};

function approval(payload?: Record<string, unknown>) {
  return {
    id: 'approval-1',
    state: 'PENDING',
    actor: 'ChatGPT',
    risk: 'MEDIUM',
    workspaceId: 'ws-1',
    sessionId: 'session-1',
    operation: { family: 'git:status', capability: 'commands.run' },
    ...(payload ? { payload } : {}),
    presentation: { title: 'Run command', action: 'Execute command', target: 'Strict sandbox' },
  };
}

function renderModal(payload?: Record<string, unknown>) {
  installApiFixtures();
  const data: RequestsData = {
    approvals: [approval(payload) as any],
    oauth: [],
    workspaces: [{ id: 'ws-1', name: 'Aevra', hostRoot: '/repo' }],
  };
  render(
    <DialogProvider>
      <RequestApprovalModal
        data={data}
        onActioned={vi.fn().mockResolvedValue(undefined)}
        onDismiss={vi.fn()}
      />
    </DialogProvider>,
  );
  return screen.getByRole('dialog', { name: 'Approval request' });
}

afterEach(() => {
  localStorage.clear();
});

test('command approvals show the exact command beside the decision', () => {
  const dialog = renderModal({
    tool: 'command_run',
    args: { executable: 'git', args: ['status', '--short'], cwdLogical: '/apps' },
    commandAnalysis: analysis,
  });
  expect(dialog).toHaveClass('wide');
  const details = within(dialog).getByRole('complementary', { name: 'Request details' });
  expect(within(details).getByTestId('command-line')).toHaveTextContent('git status --short');
  const card = details.querySelector('.command-call') as HTMLElement;
  expect(within(card).getByText('/apps')).toBeInTheDocument();
  expect(within(details).getByText('Full payload')).toBeInTheDocument();
  expect(within(details).queryByText('commandAnalysis')).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Deny' })).toBeInTheDocument();
});

test('raw view shows the full payload as sent', async () => {
  const user = userEvent.setup();
  const payload = { tool: 'shell_run', script: 'ls -la', commandAnalysis: analysis };
  const dialog = renderModal(payload);
  const details = within(dialog).getByRole('complementary', { name: 'Request details' });
  await user.click(within(details).getByRole('button', { name: 'Raw' }));
  expect(within(details).getByTestId('json-detail-raw').textContent).toBe(
    JSON.stringify(payload, null, 2),
  );
});

test('approvals without a payload keep the compact single-column modal', () => {
  const dialog = renderModal();
  expect(dialog).not.toHaveClass('wide');
  expect(within(dialog).queryByRole('complementary')).not.toBeInTheDocument();
});

test('approvalCommands finds commands across approval payload shapes', () => {
  expect(approvalCommands({ sourceTool: 'shell_run', script: 'npm ci', shell: 'bash' })).toEqual([
    { line: 'npm ci', shell: 'bash' },
  ]);
  expect(
    approvalCommands({ command: { executable: 'node', args: ['-v'] }, executionMode: 'host' }),
  ).toEqual([{ line: 'node -v', mode: 'host' }]);
  expect(
    approvalCommands({
      tool: 'capability_request',
      original: { tool: 'command_run', args: { executable: 'npm', args: ['test'] } },
    }),
  ).toEqual([{ line: 'npm test' }]);
  expect(approvalCommands({ tool: 'file_write', args: { path: 'a.txt' } })).toBeNull();
});
