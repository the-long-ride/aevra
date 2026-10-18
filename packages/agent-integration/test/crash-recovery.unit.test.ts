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
import type { AgentOptions } from '../src/types.js';

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-crash-'));
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
        return { id: `id-${++issued}`, token: `plain words ${issued}` };
      },
      async revoke(id) {
        revoked.push(id);
      },
    },
  };
  return { home, options, revoked, close: () => rmSync(home, { recursive: true, force: true }) };
}

test('uninstall keeps a user-edited entry, still revokes its credential and reports it', async () => {
  const f = fixture();
  const file = path.join(f.home, '.config/opencode/opencode.jsonc');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '{\n "theme": "custom",\n}\n');
  try {
    await manageAgent({ ...f.options, target: 'opencode' });
    const altered = readFileSync(file, 'utf8').replace('"enabled": true', '"enabled": false');
    writeFileSync(file, altered);
    const result = await manageAgent({ ...f.options, target: 'opencode', operation: 'uninstall' });
    assert.equal(readFileSync(file, 'utf8'), altered);
    assert.deepEqual(f.revoked, ['id-1']);
    assert.ok(result.notes.some((note) => note.includes('retained') && note.includes(file)));
    const status = await manageAgent({ ...f.options, operation: 'status' });
    assert.equal(status.registrations.length, 0);
  } finally {
    f.close();
  }
});

test('an install interrupted before its manifest write is undone by the next operation', async () => {
  const f = fixture();
  let calls = 0;
  const create = f.options.credentials.create;
  try {
    // The second credential never arrives: the process "dies" with the first entry written.
    const interrupted = {
      ...f.options,
      credentials: {
        ...f.options.credentials,
        create: (name: string) =>
          ++calls === 2 ? new Promise<never>(() => undefined) : create(name),
      },
    };
    void manageAgent(interrupted);
    for (let i = 0; i < 100 && calls < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 2);
    // A dead holder's lock is reclaimed (covered in state-purge tests); here it is removed.
    unlinkSync(path.join(f.home, '.agents/aevra/integration.lock'));
    const result = await manageAgent(f.options);
    assert.ok(f.revoked.includes('id-1'));
    assert.ok(result.notes.some((note) => note.includes('interrupted')));
    const status = await manageAgent({ ...f.options, operation: 'status' });
    assert.ok(status.registrations.length > 0);
    assert.ok(status.registrations.every((reg) => reg.credentialId !== 'id-1'));
    assert.ok(!existsSync(path.join(f.home, '.agents/aevra/aevra.pending.json')));
  } finally {
    f.close();
  }
});
