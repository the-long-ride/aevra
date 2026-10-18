import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddAgentModal } from './AddAgentModal';
import { detected, docsWorkspace, workspaces } from './agent-integrations.test-support';
import { installAgents } from './agent-service';

vi.mock('./agent-service', () => ({ installAgents: vi.fn() }));

const onChanged = vi.fn();
const emptyResponse = { results: [], registrations: [], notes: [], changes: [], message: '' };
const ok = (...targets: string[]) => ({
  ...emptyResponse,
  results: targets.map((target) => ({ target, ok: true })),
});

function renderModal() {
  return render(
    <AddAgentModal
      detected={detected}
      workspaces={[...workspaces, docsWorkspace]}
      onClose={vi.fn()}
      onChanged={onChanged}
    />,
  );
}
function pickWorkspaces(...names: string[]) {
  fireEvent.click(screen.getByRole('radio', { name: 'Only these workspaces' }));
  for (const name of names) fireEvent.click(screen.getByRole('switch', { name }));
}
const dialog = () => screen.getByRole('dialog', { name: 'Connect an AI agent' });

beforeEach(() => {
  vi.mocked(installAgents).mockResolvedValue(emptyResponse);
});
afterEach(() => vi.resetAllMocks());

describe('AddAgentModal multiple workspaces', () => {
  it('sends one request per selected workspace for the dry run and for the install', async () => {
    const request = vi.mocked(installAgents);
    renderModal();
    fireEvent.click(screen.getByRole('switch', { name: 'claude-code' }));
    pickWorkspaces('Main', 'Docs');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    expect(request).toHaveBeenCalledTimes(2);
    const body = (workspaceId: string, dryRun?: true) => ({
      targets: ['codex'],
      scope: 'workspace',
      workspaceId,
      transport: 'stdio',
      ...(dryRun ? { dryRun } : {}),
    });
    expect(request).toHaveBeenNthCalledWith(1, body('w1', true));
    expect(request).toHaveBeenNthCalledWith(2, body('w3', true));
    request.mockResolvedValue(ok('codex'));
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('codex (Docs): Installed');
    expect(screen.getByText('codex (Main): Installed')).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenNthCalledWith(3, body('w1'));
    expect(request).toHaveBeenNthCalledWith(4, body('w3'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps one request per click for the global scope', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    expect(installAgents).toHaveBeenCalledTimes(1);
    expect(installAgents).toHaveBeenCalledWith({
      targets: ['codex', 'claude-code'],
      scope: 'user',
      transport: 'stdio',
      dryRun: true,
    });
  });

  it('needs a workspace switched on, disables the list for global scope and handles none', () => {
    renderModal();
    expect(screen.getByRole('switch', { name: 'Docs' })).toBeDisabled();
    pickWorkspaces();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Remote only (no folder path)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Docs' }));
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Global (all my projects)' }));
    expect(screen.getByRole('switch', { name: 'Docs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
  });

  it('says when no workspace is registered', () => {
    render(
      <AddAgentModal detected={detected} workspaces={[]} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.getByText('No workspaces registered yet.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('shows a failure per workspace and retries only the failed pair', async () => {
    const request = vi.mocked(installAgents);
    renderModal();
    fireEvent.click(screen.getByRole('switch', { name: 'claude-code' }));
    pickWorkspaces('Main', 'Docs');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    request.mockReset();
    request.mockResolvedValueOnce({
      ...emptyResponse,
      results: [{ target: 'codex', ok: false, error: 'Project file is tracked by git' }],
    });
    request.mockResolvedValueOnce(ok('codex'));
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('codex (Main): Failed: Project file is tracked by git');
    expect(screen.getByText('codex (Docs): Installed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('1 of 2 failed');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch', { name: 'codex' })).toBeEnabled();
    request.mockClear();
    request.mockResolvedValue(emptyResponse);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith({
      targets: ['codex'],
      scope: 'workspace',
      workspaceId: 'w1',
      transport: 'stdio',
      dryRun: true,
    });
    request.mockResolvedValue(ok('codex'));
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
    await screen.findByText('Connection results');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({
      targets: ['codex'],
      scope: 'workspace',
      workspaceId: 'w1',
      transport: 'stdio',
    });
    expect(screen.getByText('codex (Main): Installed')).toBeInTheDocument();
    expect(screen.getByText('codex (Docs): Installed')).toBeInTheDocument();
  });

  it('turns a thrown request into failed results so the other workspaces still run', async () => {
    const request = vi.mocked(installAgents);
    renderModal();
    pickWorkspaces('Main', 'Docs');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    request.mockReset();
    request.mockRejectedValueOnce(new Error('Folder is gone'));
    request.mockResolvedValueOnce(ok('codex', 'claude-code'));
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('codex (Main): Failed: Folder is gone');
    expect(screen.getByText('claude-code (Main): Failed: Folder is gone')).toBeInTheDocument();
    expect(screen.getByText('codex (Docs): Installed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('2 of 4 failed');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('locks an agent only when it is installed in every selected workspace', async () => {
    const request = vi.mocked(installAgents);
    renderModal();
    pickWorkspaces('Main', 'Docs');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    request.mockReset();
    request.mockResolvedValueOnce({
      ...emptyResponse,
      results: [
        { target: 'codex', ok: true },
        { target: 'claude-code', ok: false, error: 'User configuration conflict' },
      ],
    });
    request.mockResolvedValueOnce(ok('codex', 'claude-code'));
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('claude-code (Main): Failed: User configuration conflict');
    expect(screen.getByRole('switch', { name: 'codex' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'claude-code' })).toBeEnabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Docs' }));
    expect(screen.queryByText(/Installed/)).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'codex' })).toBeEnabled();
  });

  it('shows a thrown dry run as an alert and stays on the form', async () => {
    const request = vi.mocked(installAgents);
    request.mockRejectedValueOnce(new Error('Workspace folder is not available'));
    renderModal();
    pickWorkspaces('Main', 'Docs');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace folder is not available');
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('AddAgentModal preview table and size', () => {
  it('lists planned changes in a two-column table naming the workspace', async () => {
    const request = vi.mocked(installAgents);
    request.mockResolvedValueOnce({
      ...emptyResponse,
      results: [{ target: 'codex', ok: true }],
      changes: [{ target: 'codex', file: '/work/main/.codex/config.toml', action: 'create' }],
      notes: ['Shared note'],
    });
    request.mockResolvedValueOnce({
      ...emptyResponse,
      results: [{ target: 'codex', ok: true }],
      changes: [{ target: 'codex', file: '/work/docs/.codex/config.toml', action: 'update' }],
      notes: ['Shared note', 'Second note'],
    });
    renderModal();
    pickWorkspaces('Main', 'Docs');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const table = await screen.findByRole('table', { name: 'Planned changes' });
    const heads = within(table).getAllByRole('columnheader');
    expect(heads.map((head) => head.textContent)).toEqual(['AI agent', 'Path']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getAllByRole('cell')).toHaveLength(2);
    expect(within(rows[0]!).getByText('codex (Main)')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Create')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('/work/main/.codex/config.toml')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('codex (Docs)')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Update')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem'),
    ).toHaveLength(2);
  });

  it('labels a global change with the agent name only', async () => {
    vi.mocked(installAgents).mockResolvedValueOnce({
      ...emptyResponse,
      changes: [{ target: 'codex', file: '/home/me/.codex/config.toml', action: 'remove' }],
    });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const table = await screen.findByRole('table', { name: 'Planned changes' });
    expect(within(table).getByText('codex')).toBeInTheDocument();
    expect(within(table).getByText('Remove')).toBeInTheDocument();
  });

  it('uses the form size on the form and the compact size on preview and done', async () => {
    renderModal();
    expect(dialog()).toHaveClass('agent-modal-size-form');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    expect(dialog()).toHaveClass('agent-modal-size-compact');
    expect(dialog()).not.toHaveClass('agent-modal-size-form');
    vi.mocked(installAgents).mockResolvedValueOnce(ok('codex', 'claude-code'));
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Connection results');
    expect(dialog()).toHaveClass('agent-modal-size-compact');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  });

  it('defines both size classes with enough specificity to beat the base modal', () => {
    const css = readFileSync('src/styles/agent-integrations.css', 'utf8');
    expect(css).toMatch(/\.management-modal\.agent-modal-size-form\s*\{[^}]*height:\s*auto/);
    expect(css).toMatch(/\.management-modal\.agent-modal-size-compact\s*\{[^}]*height:\s*auto/);
  });
});
