import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentIntegration } from '../src/admin/agent-integration.js';

// Each fixture counts how often the engine resolves an agent location (it reads CODEX_HOME once
// per resolution), which is how a status pass over every registration shows up.
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-core-byid-'));
  const home = path.join(base, 'home');
  mkdirSync(home);
  let reads = 0;
  const env = new Proxy({} as NodeJS.ProcessEnv, {
    get(target, key, receiver) {
      if (key === 'CODEX_HOME') reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  let serial = 0;
  const run = createAgentIntegration(
    { stateDir: path.join(home, 'state'), mcpPort: 47832 } as any,
    {
      async create() {
        return { id: `cred-heron-${++serial}`, token: 'pelican' };
      },
      async revoke() {},
    },
    home,
    env,
  ) as (input: unknown) => Promise<any>;
  const prepare = async () => {
    await run({ operation: 'install', targets: ['codex', 'opencode'], scope: 'user' });
    const rows = (await run({ operation: 'status', target: 'all' })).registrations;
    reads = 0;
    return rows.find((row: any) => row.target === 'codex');
  };
  return {
    run,
    prepare,
    reads: () => reads,
    close: () => rmSync(base, { recursive: true, force: true }),
  };
}

test('uninstall by credential id runs no status pass and names the removed target', async () => {
  const byId = fixture();
  const byTarget = fixture();
  try {
    const codex = await byId.prepare();
    const preview = await byId.run({
      operation: 'uninstall',
      credentialId: codex.credentialId,
      dryRun: true,
    });
    assert.deepEqual(
      preview.results.map((row: any) => [row.target, row.ok]),
      [['codex', true]],
    );
    await byTarget.prepare();
    await byTarget.run({ operation: 'uninstall', target: 'codex', scope: 'user', dryRun: true });
    assert.equal(byId.reads(), byTarget.reads());
    const out = await byId.run({ operation: 'uninstall', credentialId: codex.credentialId });
    assert.deepEqual(
      out.results.map((row: any) => [row.target, row.ok]),
      [['codex', true]],
    );
    assert.deepEqual(
      out.registrations.map((row: any) => row.target),
      ['opencode'],
    );
  } finally {
    byId.close();
    byTarget.close();
  }
});
