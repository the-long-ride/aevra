import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../../services/api-client';
import {
  detectAgents,
  installAgents,
  loadAgents,
  loadWorkspaces,
  uninstallAgent,
  type AgentRegistration,
} from './agent-service';

vi.mock('../../services/api-client', () => ({ requestJson: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const body = (call: number) =>
  JSON.parse((vi.mocked(requestJson).mock.calls[call]![1] as RequestInit).body as string);

describe('agent-service', () => {
  it('loads registrations and strips credential fields', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({
      registrations: [
        {
          target: 'codex',
          scope: 'user',
          transport: 'stdio',
          config: '/home/me/.codex/config.toml',
          credentialId: 'c1',
          credentialFile: 'hidden-file',
          credentialHash: 'hidden-hash',
          lastUsedAt: null,
        },
      ],
      message: 'ok',
    });
    const result = await loadAgents();
    expect(requestJson).toHaveBeenCalledWith('/api/agents');
    expect(result.registrations).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('keeps workspace fields and state when present and defaults lastUsedAt to null', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({
      registrations: [
        {
          target: 'claude-code',
          scope: 'workspace',
          workspaceRoot: '/work/main',
          workspaceId: 'w1',
          transport: 'stdio',
          state: 'conflict',
          config: '/home/me/.claude.json',
          credentialId: 'c2',
        },
      ],
    });
    const { registrations } = await loadAgents();
    expect(registrations[0]).toEqual({
      target: 'claude-code',
      scope: 'workspace',
      workspaceRoot: '/work/main',
      workspaceId: 'w1',
      transport: 'stdio',
      state: 'conflict',
      config: '/home/me/.claude.json',
      credentialId: 'c2',
      lastUsedAt: null,
    });
  });

  it('keeps connectorMissing for a registration whose credential is gone', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({
      registrations: [
        {
          target: 'codex',
          scope: 'user',
          transport: 'stdio',
          state: 'incomplete',
          config: '/home/me/.codex/config.toml',
          credentialId: 'c3',
          lastUsedAt: null,
          connectorMissing: true,
        },
      ],
    });
    const { registrations } = await loadAgents();
    expect(registrations[0]!.connectorMissing).toBe(true);
  });

  it('treats a response without registrations as empty', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({});
    await expect(loadAgents()).resolves.toEqual({ registrations: [] });
  });

  it('loads detection and workspaces', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce([{ target: 'codex', found: true }]);
    await expect(detectAgents()).resolves.toEqual([{ target: 'codex', found: true }]);
    expect(requestJson).toHaveBeenLastCalledWith('/api/agents/detect');
    vi.mocked(requestJson).mockResolvedValueOnce([{ id: 'w1', name: 'Main' }]);
    await expect(loadWorkspaces()).resolves.toEqual([{ id: 'w1', name: 'Main' }]);
    expect(requestJson).toHaveBeenLastCalledWith('/api/workspaces');
  });

  it('posts install for a workspace with the exact body and no path', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({ results: [], registrations: [] });
    await installAgents({
      targets: ['codex', 'opencode'],
      scope: 'workspace',
      workspaceId: 'w1',
      transport: 'stdio',
    });
    expect(vi.mocked(requestJson).mock.calls[0]![0]).toBe('/api/agents');
    expect(body(0)).toEqual({
      operation: 'install',
      targets: ['codex', 'opencode'],
      scope: 'workspace',
      workspaceId: 'w1',
      transport: 'stdio',
    });
  });

  it('fills results, notes and changes for a response from an older core', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({ message: 'aevra: uninstall complete.' });
    const result = await uninstallAgent({ target: 'codex', scope: 'user' } as AgentRegistration);
    expect(result.results).toEqual([
      { target: 'all', ok: true, message: 'aevra: uninstall complete.' },
    ]);
    expect(result.notes).toEqual([]);
    expect(result.changes).toEqual([]);
    expect(result.registrations).toEqual([]);
    vi.mocked(requestJson).mockResolvedValueOnce({ message: 'm', notes: ['kept'] });
    const install = await installAgents({ targets: ['codex'], scope: 'user', transport: 'stdio' });
    expect(install.notes).toEqual(['kept']);
  });

  it('adds dryRun only when requested and omits workspaceId for user scope', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({ results: [] });
    await installAgents({ targets: ['codex'], scope: 'user', transport: 'http', dryRun: true });
    expect(body(0)).toEqual({
      operation: 'install',
      targets: ['codex'],
      scope: 'user',
      transport: 'http',
      dryRun: true,
    });
  });

  it('uninstalls one registration by scope and workspace id', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({ results: [] });
    const registration = {
      target: 'claude-code',
      scope: 'workspace',
      workspaceId: 'w1',
      transport: 'stdio',
    } as AgentRegistration;
    await uninstallAgent(registration);
    expect(body(0)).toEqual({
      operation: 'uninstall',
      targets: ['claude-code'],
      scope: 'workspace',
      workspaceId: 'w1',
    });
  });

  it('uninstalls a workspace registration without a known workspace by its credential id', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({ results: [] });
    await uninstallAgent({
      target: 'codex',
      scope: 'workspace',
      workspaceRoot: '/elsewhere/app',
      credentialId: 'cred-heron-7',
    } as AgentRegistration);
    expect(body(0)).toEqual({ operation: 'uninstall', credentialId: 'cred-heron-7' });
  });

  it('uninstalls a global registration without a workspace id', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({ results: [] });
    await uninstallAgent({ target: 'codex', scope: 'user' } as AgentRegistration);
    expect(body(0)).toEqual({ operation: 'uninstall', targets: ['codex'], scope: 'user' });
  });
});
