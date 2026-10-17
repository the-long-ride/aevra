import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentIntegrationsSettings } from './AgentIntegrationsSettings';
import * as service from './agent-service';
import {
  confirmRemove,
  detected,
  globalCodex,
  workspaceClaude,
  workspaces,
} from './agent-integrations.test-support';

vi.mock('./agent-service', () => ({
  loadAgents: vi.fn(),
  detectAgents: vi.fn(),
  loadWorkspaces: vi.fn(),
  installAgents: vi.fn(),
  uninstallAgent: vi.fn(),
}));

const response = (message: string, results: service.AgentTargetResult[] = []) => ({
  results,
  registrations: [],
  notes: [],
  changes: [],
  message,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(service.loadAgents).mockResolvedValue({ registrations: [globalCodex] });
  vi.mocked(service.detectAgents).mockResolvedValue(detected);
  vi.mocked(service.loadWorkspaces).mockResolvedValue(workspaces);
});
afterEach(() => vi.resetAllMocks());

it('shows Loading, never the empty state, until the first load settles', async () => {
  const first = deferred<{ registrations: service.AgentRegistration[] }>();
  vi.mocked(service.loadAgents).mockReturnValue(first.promise);
  render(<AgentIntegrationsSettings />);
  expect(screen.getByText('Loading\u2026')).toBeInTheDocument();
  expect(screen.queryByText('No agents connected')).not.toBeInTheDocument();
  await act(async () => first.resolve({ registrations: [] }));
  expect(await screen.findByText('No agents connected')).toBeInTheDocument();
  expect(screen.queryByText('Loading\u2026')).not.toBeInTheDocument();
});

it('does not claim there are no agents after a load failure', async () => {
  vi.mocked(service.loadAgents).mockRejectedValue(new Error('Core is unavailable'));
  render(<AgentIntegrationsSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Core is unavailable');
  expect(screen.queryByText('No agents connected')).not.toBeInTheDocument();
  expect(screen.queryByText('Loading\u2026')).not.toBeInTheDocument();
});

it('keeps a load error and a detect error visible together', async () => {
  vi.mocked(service.loadAgents).mockRejectedValue(new Error('Load went wrong'));
  vi.mocked(service.detectAgents).mockRejectedValue(new Error('Scan went wrong'));
  render(<AgentIntegrationsSettings />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Scan went wrong'));
  expect(screen.getByRole('alert')).toHaveTextContent('Load went wrong');
});

it('lets only the newest rescan write the table', async () => {
  render(<AgentIntegrationsSettings />);
  await screen.findByText('codex');
  const slow = deferred<{ registrations: service.AgentRegistration[] }>();
  const fast = deferred<{ registrations: service.AgentRegistration[] }>();
  vi.mocked(service.loadAgents).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
  await act(async () => fast.resolve({ registrations: [workspaceClaude] }));
  await screen.findByText('claude-code');
  await act(async () => slow.resolve({ registrations: [globalCodex] }));
  expect(screen.getByText('claude-code')).toBeInTheDocument();
  expect(screen.queryByText('codex')).not.toBeInTheDocument();
});

it('clears the last message on Rescan', async () => {
  vi.mocked(service.uninstallAgent).mockResolvedValue(
    response('Removed', [{ target: 'codex', ok: true }]),
  );
  render(<AgentIntegrationsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Aevra from codex (Global)' }));
  confirmRemove('codex (Global)');
  expect(await screen.findByRole('status')).toHaveTextContent('Removed');
  fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
});

it('disables Add connection while a row action is pending', async () => {
  const pending = deferred<ReturnType<typeof response>>();
  vi.mocked(service.uninstallAgent).mockReturnValue(pending.promise);
  render(<AgentIntegrationsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Aevra from codex (Global)' }));
  confirmRemove('codex (Global)');
  expect(screen.getByRole('button', { name: 'Add connection' })).toBeDisabled();
  await act(async () => pending.resolve(response('Removed')));
  expect(screen.getByRole('button', { name: 'Add connection' })).toBeEnabled();
});

it('labels the table', async () => {
  render(<AgentIntegrationsSettings />);
  expect(await screen.findByRole('table', { name: 'Connected agents' })).toBeInTheDocument();
});

it('shows a per-target failure from Update as an alert', async () => {
  vi.mocked(service.installAgents).mockResolvedValue(
    response('Agent install: 0 of 1 succeeded', [
      { target: 'codex', ok: false, error: 'User configuration conflict' },
    ]),
  );
  render(<AgentIntegrationsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Update Aevra for codex (Global)' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('codex: User configuration conflict');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('opens the modal before detection finishes and fills it in when it arrives', async () => {
  const scan = deferred<service.DetectedAgent[]>();
  vi.mocked(service.detectAgents).mockReturnValue(scan.promise);
  render(<AgentIntegrationsSettings />);
  await screen.findByText('codex');
  fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
  const dialog = screen.getByRole('dialog', { name: 'Add connection' });
  expect(within(dialog).getByText('Detecting agents\u2026')).toBeInTheDocument();
  await act(async () => scan.resolve(detected));
  expect(within(dialog).getByRole('checkbox', { name: 'codex' })).toBeChecked();
  expect(within(dialog).queryByText(/Detecting agents/)).not.toBeInTheDocument();
});

it('shows a detect failure inside the modal', async () => {
  vi.mocked(service.detectAgents).mockRejectedValue(new Error('Scan went wrong'));
  render(<AgentIntegrationsSettings />);
  await screen.findByText('codex');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Scan went wrong'));
  fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
  const dialog = screen.getByRole('dialog', { name: 'Add connection' });
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Could not detect agents: Scan went wrong',
  );
});

it('shows a workspace load failure inside the modal', async () => {
  vi.mocked(service.loadWorkspaces).mockRejectedValue(new Error('Workspaces unavailable'));
  render(<AgentIntegrationsSettings />);
  await screen.findByText('codex');
  fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
  const dialog = screen.getByRole('dialog', { name: 'Add connection' });
  await waitFor(() =>
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Could not load workspaces: Workspaces unavailable',
    ),
  );
});

it('reloads the table when the modal reports an install', async () => {
  vi.mocked(service.installAgents).mockResolvedValue(
    response('Installed', [{ target: 'codex', ok: true }]),
  );
  render(<AgentIntegrationsSettings />);
  await screen.findByText('codex');
  expect(service.loadAgents).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
  await screen.findByText('codex: Installed');
  await waitFor(() => expect(service.loadAgents).toHaveBeenCalledTimes(2));
});

it('ignores results that arrive after the panel is unmounted', async () => {
  const agents = deferred<{ registrations: service.AgentRegistration[] }>();
  const scan = deferred<service.DetectedAgent[]>();
  const list = deferred<typeof workspaces>();
  vi.mocked(service.loadAgents).mockReturnValue(agents.promise);
  vi.mocked(service.detectAgents).mockReturnValue(scan.promise);
  vi.mocked(service.loadWorkspaces).mockReturnValue(list.promise);
  const view = render(<AgentIntegrationsSettings />);
  view.unmount();
  await act(async () => {
    agents.resolve({ registrations: [globalCodex] });
    scan.resolve(detected);
    list.resolve(workspaces);
  });
  expect(screen.queryByText('codex')).not.toBeInTheDocument();
});

it('ignores failures that arrive after the panel is unmounted', async () => {
  const agents = deferred<{ registrations: service.AgentRegistration[] }>();
  const scan = deferred<service.DetectedAgent[]>();
  const list = deferred<typeof workspaces>();
  vi.mocked(service.loadAgents).mockReturnValue(agents.promise);
  vi.mocked(service.detectAgents).mockReturnValue(scan.promise);
  vi.mocked(service.loadWorkspaces).mockReturnValue(list.promise);
  render(<AgentIntegrationsSettings />).unmount();
  await act(async () => {
    agents.reject(new Error('late'));
    scan.reject(new Error('late'));
    list.reject(new Error('late'));
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('names a failed target even when the server sent no error text', async () => {
  vi.mocked(service.uninstallAgent).mockResolvedValue(
    response('Agent uninstall: 0 of 1 succeeded', [{ target: 'codex', ok: false }]),
  );
  render(<AgentIntegrationsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Aevra from codex (Global)' }));
  confirmRemove('codex (Global)');
  expect(await screen.findByRole('alert')).toHaveTextContent('codex: Unknown error');
});

it('shows a message for a rejection that is not an Error', async () => {
  vi.mocked(service.uninstallAgent).mockRejectedValue('plain text failure');
  render(<AgentIntegrationsSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Aevra from codex (Global)' }));
  confirmRemove('codex (Global)');
  expect(await screen.findByRole('alert')).toHaveTextContent('plain text failure');
});
