import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import type { AgentOptions } from '../src/types.js';

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-recovery-'));
  let issued = 0;
  const revoked: string[] = [];
  const options: AgentOptions = {
    home,
    env: {},
    product: 'aevra',
    target: 'all',
    operation: 'install',
    transport: 'stdio',
    stateDir: path.join(home, 'state'),
    executable: process.execPath,
    entrypoint: '/cli.js',
    endpoint: 'http://localhost:47832/mcp',
    credentials: {
      async create() {
        return { id: `id-${++issued}`, token: `token-${issued}` };
      },
      async revoke(id) {
        revoked.push(id);
      },
    },
  };
  return { home, options, revoked, close: () => rmSync(home, { recursive: true, force: true }) };
}

test('a failed batch rolls back config, tokens and canonical skill without touching user content', async () => {
  const f = fixture();
  const config = path.join(f.home, '.codex/config.toml');
  mkdirSync(path.dirname(config), { recursive: true });
  writeFileSync(config, '# Keep this comment\nmodel = "custom"\n');
  let count = 0;
  f.options.credentials.create = async () => {
    if (++count === 2) throw new Error('Provider unavailable');
    return { id: 'new-id', token: 'new-token' };
  };
  try {
    await assert.rejects(manageAgent(f.options), /Provider unavailable/);
    assert.equal(readFileSync(config, 'utf8'), '# Keep this comment\nmodel = "custom"\n');
    assert.deepEqual(f.revoked, ['new-id']);
    assert.equal(existsSync(path.join(f.home, '.agents/skills/aevra')), false);
    assert.equal(existsSync(path.join(f.home, '.agents/aevra/integration.lock')), false);
  } finally {
    f.close();
  }
});

test('repeat install repairs a missing managed link and status reports missing resources', async () => {
  const f = fixture();
  try {
    await manageAgent({ ...f.options, target: 'claude-code' });
    const link = path.join(f.home, '.claude/skills/aevra');
    unlinkSync(link);
    const damaged = await manageAgent({ ...f.options, operation: 'status' });
    assert.equal(damaged.registrations[0].state, 'incomplete');
    await manageAgent({ ...f.options, target: 'claude-code' });
    assert.ok(existsSync(link));
  } finally {
    f.close();
  }
});

test('JSONC comments are preserved; simultaneous mutation is refused', async () => {
  const f = fixture();
  const file = path.join(f.home, '.config/opencode/opencode.jsonc');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '{\n // retain me\n "theme": "custom",\n}\n');
  try {
    await manageAgent({ ...f.options, target: 'opencode' });
    assert.match(readFileSync(file, 'utf8'), /retain me/);

    const lock = path.join(f.home, '.agents/aevra/integration.lock');
    writeFileSync(lock, 'busy');
    await assert.rejects(manageAgent({ ...f.options, target: 'codex' }), /BUSY/);
    unlinkSync(lock);
  } finally {
    f.close();
  }
});
