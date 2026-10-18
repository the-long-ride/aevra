import { fireEvent, screen } from '@testing-library/react';
import type { AgentRegistration, DetectedAgent } from './agent-service';

export const detected: DetectedAgent[] = [
  {
    target: 'codex',
    found: true,
    evidence: 'path',
    configPath: '/home/me/.codex/config.toml',
    scopes: ['user', 'workspace'],
  },
  {
    target: 'claude-code',
    found: true,
    evidence: 'config',
    configPath: '/home/me/.claude.json',
    scopes: ['user', 'workspace'],
  },
  {
    target: 'opencode',
    found: false,
    evidence: 'none',
    configPath: '',
    scopes: ['user', 'workspace'],
  },
  {
    target: 'antigravity',
    found: false,
    evidence: 'none',
    configPath: '',
    scopes: ['user', 'workspace'],
  },
];

export const workspaces = [
  { id: 'w1', name: 'Main', hostRoot: '/work/main' },
  { id: 'w2', name: 'Remote only' },
];

export const docsWorkspace = { id: 'w3', name: 'Docs', hostRoot: '/work/docs' };

export const globalCodex: AgentRegistration = {
  target: 'codex',
  scope: 'user',
  transport: 'stdio',
  state: 'installed',
  config: '/home/me/.codex/config.toml',
  credentialId: 'conn-one',
  lastUsedAt: null,
};

export const workspaceClaude: AgentRegistration = {
  target: 'claude-code',
  scope: 'workspace',
  workspaceRoot: '/work/main',
  workspaceId: 'w1',
  transport: 'stdio',
  state: 'installed',
  config: '/home/me/.claude.json',
  credentialId: 'conn-two',
  lastUsedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};

// Confirms the inline Remove prompt of one row, named like `codex (Global)`.
export function confirmRemove(row: string) {
  fireEvent.click(screen.getByRole('button', { name: `Confirm removing Aevra from ${row}` }));
}
