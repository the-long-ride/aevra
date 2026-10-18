import assert from 'node:assert/strict';
import test from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { hash } from '../src/files.js';
import { acquireIntegrationLock } from '../src/lock.js';
import type { AgentOptions } from '../src/types.js';

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-journal-'));
  let issued = 0;
  const revoked: string[] = [];
  const failing = new Set<string>();
  const options: AgentOptions = {
    home,
    env: {},
    product: 'aevra',
    target: 'opencode',
    operation: 'install',
    transport: 'stdio',
    stateDir: path.join(home, 'state'),
    executable: process.execPath,
    entrypoint: '/cli.js',
    endpoint: 'http://localhost:47832/mcp',
    credentials: {
      async create() {
        return { id: `id-${++issued}`, token: `plain words ${issued}` };
      },
      async revoke(id) {
        if (failing.has(id)) throw new Error('revoke refused');
        revoked.push(id);
      },
    },
  };
  const pending = path.join(home, '.agents/aevra/aevra.pending.json');
  return {
    home,
    options,
    revoked,
    failing,
    pending,
    close: () => rmSync(home, { recursive: true, force: true }),
  };
}

const config = (home: string) => path.join(home, '.config/opencode/opencode.json');

test('a committed uninstall whose revoke failed is finished, never undone, by the next run', async () => {
  const f = fixture();
  try {
    await manageAgent(f.options);
    const installed = readFileSync(config(f.home), 'utf8');
    f.failing.add('id-1');
    await assert.rejects(
      manageAgent({ ...f.options, operation: 'uninstall' }),
      /AGENT_REVOKE_INCOMPLETE/,
    );
    const removed = readFileSync(config(f.home), 'utf8');
    assert.notEqual(removed, installed);
    assert.ok(existsSync(f.pending));
    f.failing.clear();
    const status = await manageAgent({ ...f.options, operation: 'status' });
    assert.ok(status.notes.some((note) => note.startsWith('pending')));
    // The uninstall recovers it even though nothing is registered any more.
    const result = await manageAgent({ ...f.options, operation: 'uninstall' });
    assert.ok(result.notes.some((note) => note.includes('finished an interrupted')));
    assert.deepEqual(f.revoked, ['id-1']);
    assert.equal(readFileSync(config(f.home), 'utf8'), removed);
    assert.ok(!existsSync(f.pending));
  } finally {
    f.close();
  }
});

test('a planted journal naming an unrelated file is refused and the file is untouched', async () => {
  const f = fixture();
  const victim = path.join(f.home, '.bashrc');
  try {
    writeFileSync(victim, 'user settings');
    mkdirSync(path.dirname(f.pending), { recursive: true });
    const journal = {
      version: 1,
      writes: [{ file: victim, before: 'replaced', afterHash: hash('user settings') }],
      linked: [],
      removedLinks: [],
      issued: [],
      issuing: [],
      retired: [],
      cleanup: [],
      committed: false,
    };
    writeFileSync(f.pending, JSON.stringify(journal));
    await assert.rejects(manageAgent(f.options), (error: Error) => {
      assert.match(error.message, /AGENT_JOURNAL_INVALID/);
      assert.ok(error.message.includes(f.pending));
      return true;
    });
    assert.equal(readFileSync(victim, 'utf8'), 'user settings');
    writeFileSync(f.pending, '{ not valid');
    await assert.rejects(manageAgent(f.options), /AGENT_JOURNAL_INVALID: .*pending\.json/);
  } finally {
    f.close();
  }
});

test('a released lock that another process took over is left in place', () => {
  const f = fixture();
  const file = path.join(f.home, '.agents/aevra/integration.lock');
  try {
    const release = acquireIntegrationLock(file);
    writeFileSync(file, JSON.stringify({ pid: process.pid, created: 'another holder' }));
    release();
    assert.ok(existsSync(file));
    unlinkSync(file);
    // A dead holder's lock is taken over, and released normally afterwards.
    writeFileSync(file, JSON.stringify({ pid: 2 ** 30, created: 'crashed holder' }));
    const again = acquireIntegrationLock(file);
    again();
    assert.ok(!existsSync(file));
  } finally {
    f.close();
  }
});
