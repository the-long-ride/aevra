import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

beforeEach(() => {
  vi.mocked(service.loadAgents).mockResolvedValue({
    registrations: [globalCodex, workspaceClaude],
  });
  vi.mocked(service.detectAgents).mockResolvedValue(detected);
  vi.mocked(service.loadWorkspaces).mockResolvedValue(workspaces);
});
afterEach(() => vi.resetAllMocks());

it('lists scope, transport, config, state and last used per registration', async () => {
  render(<AgentIntegrationsSettings />);
  const global = (await screen.findByText('codex')).closest('tr')!;
  expect(within(global).getByText('Global')).toBeInTheDocument();
  expect(within(global).getByText('stdio')).toBeInTheDocument();
  expect(within(global).getByText('/home/me/.codex/config.toml')).toBeInTheDocument();
  expect(within(global).getByText('installed')).toBeInTheDocument();
  expect(within(global).getByText('Never used')).toBeInTheDocument();
  const scoped = screen.getByText('claude-code').closest('tr')!;
  expect(within(scoped).getByText('Main')).toBeInTheDocument();
  expect(within(scoped).getByText('5 min ago')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Update Aevra for codex (Global)' })).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Remove Aevra from claude-code (Main)' }),
  ).toBeEnabled();
});

it('shows the empty state', async () => {
  vi.mocked(service.loadAgents).mockResolvedValue({ registrations: [] });
  render(<AgentIntegrationsSettings />);
  expect(await screen.findByText('No agents connected')).toBeInTheDocument();
});

it('shows a load failure as an alert', async () => {
  vi.mocked(service.loadAgents).mockRejectedValue(new Error('Core is unavailable'));
  render(<AgentIntegrationsSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Core is unavailable');
});

it('opens the Add connection modal with detected agents and refreshes after Rescan', async () => {
  render(<AgentIntegrationsSettings />);
  await screen.findByText('codex');
  fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
  expect(screen.getByRole('dialog', { name: 'Add connection' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'opencode' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
  await waitFor(() => expect(service.detectAgents).toHaveBeenCalledTimes(2));
  expect(service.loadAgents).toHaveBeenCalledTimes(2);
});

it('removes a workspace registration by scope and workspace, then reloads', async () => {
  vi.mocked(service.uninstallAgent).mockResolvedValue(
    response('Removed', [{ target: 'claude-code', ok: true }]),
  );
  render(<AgentIntegrationsSettings />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Remove Aevra from claude-code (Main)' }),
  );
  confirmRemove('claude-code (Main)');
  expect(await screen.findByRole('status')).toHaveTextContent('Removed');
  expect(service.uninstallAgent).toHaveBeenCalledWith(workspaceClaude);
  expect(service.loadAgents).toHaveBeenCalledTimes(2);
});

it('shows a per-target failure from Remove and a thrown conflict as alerts', async () => {
  vi.mocked(service.uninstallAgent)
    .mockResolvedValueOnce(
      response('Agent uninstall: 0 of 1 succeeded', [
        { target: 'codex', ok: false, error: 'User configuration conflict' },
      ]),
    )
    .mockRejectedValueOnce(new Error('Config file is read only'));
  render(<AgentIntegrationsSettings />);
  const remove = () => screen.findByRole('button', { name: 'Remove Aevra from codex (Global)' });
  fireEvent.click(await remove());
  confirmRemove('codex (Global)');
  expect(await screen.findByRole('alert')).toHaveTextContent('User configuration conflict');
  fireEvent.click(await remove());
  confirmRemove('codex (Global)');
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Config file is read only'),
  );
});

it('updates a registration with the same scope and disables actions while pending', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(service.installAgents).mockImplementation(
    () => new Promise((resolve) => (finish = resolve)) as never,
  );
  render(<AgentIntegrationsSettings />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Update Aevra for claude-code (Main)' }),
  );
  expect(service.installAgents).toHaveBeenCalledWith({
    targets: ['claude-code'],
    scope: 'workspace',
    workspaceId: 'w1',
    transport: 'stdio',
  });
  expect(screen.getByRole('button', { name: 'Remove Aevra from codex (Global)' })).toBeDisabled();
  finish(response('Updated', [{ target: 'claude-code', ok: true }]));
  expect(await screen.findByRole('status')).toHaveTextContent('Updated');
  expect(screen.getByRole('button', { name: 'Remove Aevra from codex (Global)' })).toBeEnabled();
});

it('cannot update a workspace registration Aevra does not know, but can remove it', async () => {
  const orphan = { ...workspaceClaude, workspaceId: undefined, workspaceRoot: '/elsewhere/app' };
  vi.mocked(service.loadAgents).mockResolvedValue({ registrations: [orphan] });
  vi.mocked(service.uninstallAgent).mockResolvedValue(
    response('Removed', [{ target: 'claude-code', ok: true }]),
  );
  render(<AgentIntegrationsSettings />);
  expect(await screen.findByText('/elsewhere/app')).toBeInTheDocument();
  const update = 'Update Aevra for claude-code (/elsewhere/app)';
  expect(screen.getByRole('button', { name: update })).toBeDisabled();
  expect(screen.getByText(/not a registered Aevra workspace/)).toBeInTheDocument();
  const remove = screen.getByRole('button', {
    name: 'Remove Aevra from claude-code (/elsewhere/app)',
  });
  expect(remove).toBeEnabled();
  fireEvent.click(remove);
  confirmRemove('claude-code (/elsewhere/app)');
  expect(await screen.findByRole('status')).toHaveTextContent('Removed');
  expect(service.uninstallAgent).toHaveBeenCalledWith(orphan);
});
