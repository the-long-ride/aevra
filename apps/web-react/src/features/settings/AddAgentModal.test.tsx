import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddAgentModal } from './AddAgentModal';
import { detected, workspaces } from './agent-integrations.test-support';
import { installAgents } from './agent-service';

vi.mock('./agent-service', () => ({ installAgents: vi.fn() }));

const onClose = vi.fn();
const onChanged = vi.fn();
const emptyResponse = { results: [], registrations: [], notes: [], changes: [], message: '' };

function renderModal() {
  return render(
    <AddAgentModal
      detected={detected}
      workspaces={workspaces}
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
}
const row = (name: string) => within(screen.getByRole('group', { name }));

beforeEach(() => vi.mocked(installAgents).mockResolvedValue(emptyResponse));
afterEach(() => vi.resetAllMocks());

describe('AddAgentModal selection', () => {
  it('is a labelled dialog with found agents pre-switched on and undetected ones disabled', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Connect an AI agent' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'codex' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'claude-code' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'opencode' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'opencode' })).not.toBeChecked();
    expect(screen.getByText('Found: /home/me/.codex/config.toml')).toBeInTheDocument();
    expect(screen.getAllByText('Not found')).toHaveLength(4);
  });

  it('Install anyway enables and selects an undetected agent', () => {
    renderModal();
    fireEvent.click(row('opencode').getByRole('switch', { name: 'Install opencode anyway' }));
    expect(screen.getByRole('switch', { name: 'opencode' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'opencode' })).toBeChecked();
    fireEvent.click(row('opencode').getByRole('switch', { name: 'Install opencode anyway' }));
    expect(screen.getByRole('switch', { name: 'opencode' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'opencode' })).not.toBeChecked();
  });

  it('workspace scope disables HTTP, shows why, and falls back to stdio', () => {
    renderModal();
    fireEvent.click(screen.getByRole('radio', { name: 'HTTP' }));
    expect(screen.getByRole('radio', { name: 'HTTP' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Only these workspaces' }));
    expect(screen.getByRole('radio', { name: 'stdio (recommended)' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'HTTP' })).toBeDisabled();
    expect(screen.getByText(/workspace connections use stdio only/i)).toBeInTheDocument();
    expect(screen.getByText(/No skill is installed for a single workspace/)).toBeInTheDocument();
    expect(screen.getByText(/Codex only loads project configuration/)).toBeInTheDocument();
  });

  it('disables a workspace without a folder path and requires a choice to preview', () => {
    renderModal();
    expect(screen.queryByRole('switch', { name: 'Main' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Only these workspaces' }));
    expect(screen.getByRole('switch', { name: 'Remote only (no folder path)' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Main' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Main' }));
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Main' }));
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });

  it('disables Preview when nothing is selected and closes on Escape', () => {
    renderModal();
    fireEvent.click(screen.getByRole('switch', { name: 'codex' }));
    fireEvent.click(screen.getByRole('switch', { name: 'claude-code' }));
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('AddAgentModal preview and install', () => {
  it('previews the dry run and then sends the exact install body', async () => {
    const request = vi.mocked(installAgents);
    request.mockResolvedValueOnce({
      ...emptyResponse,
      results: [{ target: 'codex', ok: true }],
      changes: [{ target: 'codex', file: '/work/main/.codex/config.toml', action: 'create' }],
      notes: ['Added .codex/config.toml to the git exclude file'],
    });
    renderModal();
    fireEvent.click(screen.getByRole('switch', { name: 'claude-code' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Only these workspaces' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const planned = await screen.findByRole('table', { name: 'Planned changes' });
    expect(within(planned).getByText('/work/main/.codex/config.toml')).toBeInTheDocument();
    expect(
      screen.getByText('Added .codex/config.toml to the git exclude file'),
    ).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith({
      targets: ['codex'],
      scope: 'workspace',
      workspaceId: 'w1',
      transport: 'stdio',
      dryRun: true,
    });
    request.mockResolvedValueOnce({ ...emptyResponse, results: [{ target: 'codex', ok: true }] });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('codex (Main): Installed');
    expect(request).toHaveBeenLastCalledWith({
      targets: ['codex'],
      scope: 'workspace',
      workspaceId: 'w1',
      transport: 'stdio',
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Back returns to the form and a preview failure shows its message', async () => {
    const request = vi.mocked(installAgents);
    request.mockResolvedValueOnce(emptyResponse);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('switch', { name: 'codex' })).toBeChecked();
    request.mockRejectedValueOnce(new Error('Workspace folder is not available'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace folder is not available');
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('stays open on partial failure, marks the success and retries only the failed agent', async () => {
    const request = vi.mocked(installAgents);
    request.mockResolvedValueOnce(emptyResponse);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    request.mockResolvedValueOnce({
      ...emptyResponse,
      results: [
        { target: 'codex', ok: true },
        { target: 'claude-code', ok: false, error: 'User configuration conflict' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('claude-code: Failed: User configuration conflict');
    expect(screen.getByText('codex: Installed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('1 of 2');
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Connect an AI agent' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'codex' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'claude-code' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'claude-code' })).toBeChecked();
    request.mockResolvedValueOnce(emptyResponse);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith({
        targets: ['claude-code'],
        scope: 'user',
        transport: 'stdio',
        dryRun: true,
      }),
    );
  });

  it('keeps the modal open and shows the message when the install request fails', async () => {
    const request = vi.mocked(installAgents);
    request.mockResolvedValueOnce(emptyResponse);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    request.mockRejectedValueOnce(new Error('Core is unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Core is unavailable');
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
