import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { agentLocation } from '../src/adapters.js';
import { skillText } from '../src/skills.js';
import type { AgentOptions } from '../src/types.js';

function options(home: string, product: AgentOptions['product']): AgentOptions {
  let serial = 0;
  return {
    home,
    env: {},
    product,
    target: 'codex',
    operation: 'install',
    transport: 'stdio',
    executable: '/node',
    entrypoint: '/app/cli.js',
    stateDir: path.join(home, `state-${product}`),
    endpoint: 'https://localhost:47832/mcp',
    credentials: {
      async create() {
        return { id: `id-${++serial}`, token: 'plain words' };
      },
      async revoke() {},
    },
  };
}

test('the aevra stdio entry launches agent serve, the browser product keeps its own args', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-stdio-entry-'));
  try {
    const claude = agentLocation('claude-code', home, {});
    mkdirSync(path.dirname(claude.config), { recursive: true });
    for (const product of ['aevra', 'aevra-browser'] as const)
      await manageAgent({ ...options(home, product), target: 'claude-code' });
    const servers = JSON.parse(readFileSync(claude.config, 'utf8')).mcpServers;
    const aevra = servers.aevra.args as string[];
    assert.deepEqual(aevra.slice(0, 4), ['/app/cli.js', 'agent', 'serve', '--credential-file']);
    assert.equal(aevra.length, 5);
    assert.ok(path.basename(aevra[4]!).startsWith('claude-code-'));
    const browser = servers['aevra-browser'].args as string[];
    assert.deepEqual(browser.slice(0, 2), ['/app/cli.js', 'mcp']);
    assert.equal(browser[2], '--credential-file');
    assert.equal(browser.length, 4);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the skill text names the command the generated config runs', () => {
  assert.match(skillText('aevra'), /stdio launches aevra agent serve\./);
  assert.doesNotMatch(skillText('aevra'), /mcp serve/);
  assert.match(skillText('aevra-browser'), /stdio launches aevra-browser mcp\./);
});
