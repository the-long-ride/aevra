import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAgentRoutes } from '../src/admin/routes/agent-routes.js';

async function list(context: any) {
  let body = '';
  const req = Readable.from([]) as any;
  req.method = 'GET';
  req.headers = {};
  const res: any = {
    statusCode: 0,
    setHeader() {},
    once() {},
    end(value = '') {
      body = String(value);
    },
  };
  await handleAgentRoutes(req, res, new URL('https://localhost/api/agents'), context);
  return JSON.parse(body).registrations;
}

const status = (registrations: unknown[]) => async () => ({
  dryRun: false,
  message: 'status',
  registrations,
  notes: [],
  changes: [],
});

test('a registration whose connector is gone is incomplete and marked connectorMissing', async () => {
  const registrations = [
    { target: 'codex', scope: 'user', credentialId: 'cred-one', state: 'installed' },
    { target: 'opencode', scope: 'user', credentialId: 'cred-gone', state: 'installed' },
  ];
  const connectors = { list: () => [{ id: 'cred-one', lastUsedAt: null }] };
  const rows = await list({ agents: status(registrations), connectors });
  assert.equal(rows[0].lastUsedAt, null);
  assert.equal('connectorMissing' in rows[0], false);
  assert.equal(rows[0].state, 'installed');
  assert.equal(rows[1].lastUsedAt, null);
  assert.equal(rows[1].connectorMissing, true);
  assert.equal(rows[1].state, 'incomplete');
  // Without a connector list nothing is known to be missing.
  const bare = await list({ agents: status(registrations) });
  assert.equal('connectorMissing' in bare[1], false);
  assert.equal(bare[1].state, 'installed');
});

test('a workspace registration joins its Aevra workspace by the engine root key', async () => {
  const root = path.resolve('garden-root');
  const registrations = [
    { target: 'codex', scope: 'workspace', workspaceRoot: root, credentialId: 'cred-one' },
  ];
  for (const hostRoot of [path.join(root, 'sub', '..'), root + path.sep]) {
    const workspaces = { listLocal: () => [{ id: 'w1', name: 'Garden', hostRoot }] };
    const [row] = await list({ agents: status(registrations), workspaces });
    assert.equal(row.workspaceId, 'w1', hostRoot);
  }
});
