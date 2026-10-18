import path from 'node:path';
import { existsSync } from 'node:fs';
import type { AgentLocation, AgentOptions, AgentScope, AgentTarget, Credential } from './types.js';
import { resolveClaudeProjectKey } from './claude-project-key.js';
import { readText } from './files.js';

function workspaceLocation(
  target: AgentTarget,
  root: string,
  claudeConfig: string,
  claudeKey?: string,
): AgentLocation {
  switch (target) {
    case 'codex':
      return {
        config: path.join(root, '.codex', 'config.toml'),
        kind: 'toml',
        entryPath: ['mcp_servers'],
        skills: [],
      };
    case 'claude-code':
      return {
        config: claudeConfig,
        kind: 'json',
        entryPath: [
          'projects',
          claudeKey ?? resolveClaudeProjectKey(readText(claudeConfig) ?? '', root),
          'mcpServers',
        ],
        skills: [],
      };
    case 'opencode':
      return {
        config: path.join(
          root,
          existsSync(path.join(root, 'opencode.jsonc')) ? 'opencode.jsonc' : 'opencode.json',
        ),
        kind: 'jsonc',
        entryPath: ['mcp'],
        skills: [],
      };
    case 'antigravity':
      return {
        config: path.join(root, '.agents', 'mcp_config.json'),
        kind: 'json',
        entryPath: ['mcpServers'],
        skills: [],
      };
  }
}

export function agentLocation(
  target: AgentTarget,
  home: string,
  env: Record<string, string | undefined>,
  scope: AgentScope = 'user',
  workspaceRoot?: string,
  claudeKey?: string,
): AgentLocation {
  const codex = env.CODEX_HOME || path.join(home, '.codex');
  const claude = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const claudeConfig = env.CLAUDE_CONFIG_DIR
    ? path.join(claude, '.claude.json')
    : path.join(home, '.claude.json');
  if (scope === 'workspace') {
    if (!workspaceRoot) throw new Error('AGENT_OPTIONS_INVALID: workspace scope needs a root');
    return workspaceLocation(target, workspaceRoot, claudeConfig, claudeKey);
  }
  const open = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode');
  const gemini = path.join(home, '.gemini');
  const current = path.join(gemini, 'config/mcp_config.json');
  const legacy = path.join(gemini, 'antigravity/mcp_config.json');
  if (target === 'antigravity' && existsSync(current) && existsSync(legacy))
    throw new Error('AGENT_CONFIG_CONFLICT: two Antigravity profiles exist; select one explicitly');
  switch (target) {
    case 'codex':
      return {
        config: path.join(codex, 'config.toml'),
        kind: 'toml',
        entryPath: ['mcp_servers'],
        skills: [],
      };
    case 'claude-code':
      return {
        config: claudeConfig,
        kind: 'json',
        entryPath: ['mcpServers'],
        skills: [path.join(claude, 'skills')],
      };
    case 'opencode':
      return {
        config:
          env.OPENCODE_CONFIG ||
          path.join(
            open,
            existsSync(path.join(open, 'opencode.jsonc')) ? 'opencode.jsonc' : 'opencode.json',
          ),
        kind: 'jsonc',
        entryPath: ['mcp'],
        skills: [path.join(open, 'skills')],
      };
    case 'antigravity':
      return {
        config: existsSync(legacy) ? legacy : current,
        kind: 'json',
        entryPath: ['mcpServers'],
        skills: [
          path.join(gemini, existsSync(legacy) ? 'antigravity/skills' : 'config/skills'),
          path.join(gemini, 'antigravity-cli/skills'),
        ],
      };
  }
}

export function nativeEntry(
  options: AgentOptions,
  target: AgentTarget,
  credentialFile: string,
  credential: Credential,
): Record<string, unknown> {
  if (options.transport === 'http') {
    if (target === 'codex')
      return {
        url: options.endpoint,
        http_headers: { Authorization: `Bearer ${credential.token}` },
      };
    if (target === 'opencode')
      return {
        type: 'remote',
        url: options.endpoint,
        headers: { Authorization: `Bearer ${credential.token}` },
        enabled: true,
      };
    if (target === 'antigravity')
      return {
        serverUrl: options.endpoint,
        headers: { Authorization: `Bearer ${credential.token}` },
      };
    return {
      type: 'http',
      url: options.endpoint,
      headers: { Authorization: `Bearer ${credential.token}` },
    };
  }
  const args = [
    options.entrypoint,
    ...(options.product === 'aevra' ? ['agent', 'serve'] : ['mcp']),
    '--credential-file',
    credentialFile,
  ];
  if (target === 'opencode')
    return { type: 'local', command: [options.executable, ...args], enabled: true };
  return {
    ...(target === 'claude-code' ? { type: 'stdio' } : {}),
    command: options.executable,
    args,
  };
}
