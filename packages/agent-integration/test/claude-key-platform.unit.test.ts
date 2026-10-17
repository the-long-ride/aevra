import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { resolveClaudeProjectKey } from '../src/claude-project-key.js';
import { checkRegistration } from '../src/manifest-validate.js';
import type { AgentOptions, Registration } from '../src/types.js';

const withProjects = (...keys: string[]) =>
  JSON.stringify({ projects: Object.fromEntries(keys.map((key) => [key, { mcpServers: {} }])) });

test('on a case-sensitive platform a key differing in case is not reused', () => {
  const text = withProjects('/src/Proj');
  for (const platform of ['linux', 'freebsd'] as const) {
    assert.equal(resolveClaudeProjectKey(text, '/src/proj', platform), '/src/proj');
    assert.equal(resolveClaudeProjectKey(text, '/src/Proj', platform), '/src/Proj');
    assert.equal(
      resolveClaudeProjectKey(withProjects('/src/a\\b'), '/src/a/b', platform),
      '/src/a/b',
    );
  }
});

test('on darwin case is folded but slash direction is not', () => {
  assert.equal(
    resolveClaudeProjectKey(withProjects('/src/Proj'), '/src/proj', 'darwin'),
    '/src/Proj',
  );
  assert.equal(
    resolveClaudeProjectKey(withProjects('/src/a\\b'), '/src/a/b', 'darwin'),
    '/src/a/b',
  );
});

test('on win32 case, slash direction and trailing separators are still ignored', () => {
  const text = withProjects('F:/repos/bravo');
  assert.equal(resolveClaudeProjectKey(text, 'F:\\Repos\\Bravo\\', 'win32'), 'F:/repos/bravo');
  assert.equal(resolveClaudeProjectKey('{}', 'F:\\x\\y', 'win32'), 'F:/x/y');
});

function claudeRegistration(key: string) {
  const home = path.resolve('agent-home');
  const root = path.resolve('agent-home', 'Project');
  const options = { home, env: {}, stateDir: path.join(home, 'state') } as unknown as AgentOptions;
  const reg: Registration = {
    target: 'claude-code',
    scope: 'workspace',
    workspaceRoot: root,
    transport: 'stdio',
    config: path.join(home, '.claude.json'),
    entryPath: ['projects', key, 'mcpServers'],
    entryHash: 'plain',
    credentialId: 'plain',
    credentialFile: path.join(home, 'state', 'agent-credentials', 'claude-code-plain.json'),
    credentialHash: 'plain',
    links: [],
  };
  return { options, reg, root };
}

test('the manifest Claude key check follows the platform rules', () => {
  const { root } = claudeRegistration('');
  const upper = root.toUpperCase();
  const accept = (key: string, platform: NodeJS.Platform) => {
    const { options, reg } = claudeRegistration(key);
    checkRegistration(options, reg, new Set(), platform);
  };
  const refuse = (key: string, platform: NodeJS.Platform) =>
    assert.throws(() => accept(key, platform), /AGENT_MANIFEST_INVALID/, `${platform} ${key}`);
  accept(root, 'linux');
  refuse(upper, 'linux');
  accept(upper, 'darwin');
  accept(upper, 'win32');
  if (root.includes('\\')) {
    const forward = root.replaceAll('\\', '/');
    accept(forward, 'win32');
    refuse(forward, 'linux');
    refuse(forward, 'darwin');
  }
});
