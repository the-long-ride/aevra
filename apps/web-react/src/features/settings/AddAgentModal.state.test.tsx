import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddAgentModal } from './AddAgentModal';
import { detected, workspaces } from './agent-integrations.test-support';
import { installAgents } from './agent-service';

vi.mock('./agent-service', () => ({ installAgents: vi.fn() }));

const onClose = vi.fn();
const onChanged = vi.fn();
const emptyResponse = { results: [], registrations: [], notes: [], changes: [], message: '' };
type Props = Partial<React.ComponentProps<typeof AddAgentModal>>;

function modal(props: Props = {}) {
  return (
    <AddAgentModal
      detected={detected}
      workspaces={workspaces}
      onClose={onClose}
      onChanged={onChanged}
      {...props}
    />
  );
}
const dialog = () => screen.getByRole('dialog', { name: 'Add connection' });
const insideDialog = () => dialog().contains(document.activeElement);

beforeEach(() => vi.mocked(installAgents).mockResolvedValue(emptyResponse));
afterEach(() => vi.resetAllMocks());

describe('AddAgentModal detection states', () => {
  it('shows Detecting while detection is pending and pre-checks agents once they arrive', () => {
    const view = render(modal({ detected: [], detectStatus: 'loading' }));
    expect(screen.getByRole('status')).toHaveTextContent('Detecting agents\u2026');
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    view.rerender(modal({ detectStatus: 'ready' }));
    expect(screen.getByRole('checkbox', { name: 'codex' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    expect(screen.queryByText(/Detecting agents/)).not.toBeInTheDocument();
  });

  it('does not override a selection the user already changed', () => {
    const view = render(modal());
    fireEvent.click(screen.getByRole('checkbox', { name: 'codex' }));
    view.rerender(modal({ detected: detected.map((item) => ({ ...item })) }));
    expect(screen.getByRole('checkbox', { name: 'codex' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'claude-code' })).toBeChecked();
  });

  it('says when no agent was detected and shows a detect error', () => {
    const view = render(modal({ detected: [] }));
    expect(screen.getByRole('status')).toHaveTextContent('No agents detected');
    view.rerender(modal({ detected: [], detectStatus: 'failed', detectError: 'Scan failed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not detect agents: Scan failed');
    expect(screen.queryByText('No agents detected')).not.toBeInTheDocument();
  });

  it('shows a workspace load failure', () => {
    render(modal({ workspaces: [], workspaceError: 'Workspaces unavailable' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load workspaces: Workspaces unavailable',
    );
  });

  it('gives every Install anyway checkbox its own name', () => {
    render(modal());
    expect(screen.getByRole('checkbox', { name: 'Install opencode anyway' })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Install antigravity anyway' }),
    ).toBeInTheDocument();
  });
});

describe('AddAgentModal focus and live regions', () => {
  it('moves focus to the Preview heading, a labelled live region', async () => {
    render(modal());
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const heading = await screen.findByRole('heading', { name: 'Preview' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(insideDialog()).toBe(true);
    const region = screen.getByRole('region', { name: 'Preview' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H3'));
    expect(insideDialog()).toBe(true);
  });

  it('keeps focus in the dialog after a partial failure and wraps results in a status region', async () => {
    const request = vi.mocked(installAgents);
    render(modal());
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
    await waitFor(() => expect(insideDialog()).toBe(true));
    expect(document.activeElement).not.toBe(document.body);
    const status = screen.getByRole('status', { name: 'Install results' });
    expect(status.tagName).toBe('DIV');
    expect(within(status).getAllByRole('listitem')).toHaveLength(2);
  });

  it('keeps focus in the dialog when a request throws', async () => {
    render(modal());
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    vi.mocked(installAgents).mockRejectedValueOnce(new Error('Core is unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByRole('alert');
    await waitFor(() => expect(insideDialog()).toBe(true));
  });
});

describe('AddAgentModal install details', () => {
  it('clears the Installed lock when scope, workspace or transport changes', async () => {
    const request = vi.mocked(installAgents);
    render(modal());
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
    await screen.findByText('codex: Installed');
    expect(screen.getByRole('checkbox', { name: 'codex' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Only this workspace' }));
    expect(screen.queryByText('codex: Installed')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'codex' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'codex' })).toBeChecked();
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'w1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith({
        targets: ['codex', 'claude-code'],
        scope: 'workspace',
        workspaceId: 'w1',
        transport: 'stdio',
        dryRun: true,
      }),
    );
  });

  it('includes a forced undetected agent in the install body', async () => {
    const request = vi.mocked(installAgents);
    render(modal());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Install opencode anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('No files would change.');
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith({
        targets: ['codex', 'claude-code', 'opencode'],
        scope: 'user',
        transport: 'stdio',
      }),
    );
  });

  it('disables Install when every dry-run result failed and lists the problems', async () => {
    vi.mocked(installAgents).mockResolvedValueOnce({
      ...emptyResponse,
      results: [
        { target: 'codex', ok: false, error: 'Project file is tracked by git' },
        { target: 'claude-code', ok: false },
      ],
    });
    render(modal());
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('codex: Project file is tracked by git');
    expect(screen.getByText('claude-code: Unknown error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });

  it('ignores Escape and Close while a request is in flight', async () => {
    render(modal());
    let finish!: (value: typeof emptyResponse) => void;
    vi.mocked(installAgents).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('button', { name: 'Previewing\u2026' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish(emptyResponse));
    await screen.findByText('No files would change.');
  });
});
