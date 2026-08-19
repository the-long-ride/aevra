import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { McpToolService } from '../../../packages/mcp-tools/src/service.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
function setup(bindings: { workspaceId: string | null; profileCap: string | null }) {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const wsRepo = new WorkspaceRepository(raw);
  const ws = wsRepo.create({
    name: 'main',
    hostRoot: mkdtempSync(path.join(tmpdir(), 'aevra-bind-')),
  });
  const sessions = new SessionManager(
    new SessionRepository(raw),
    new CapabilityProfileService(raw),
  );
  const session = sessions.create({
    subject: 'con_1',
    actor: 'connector:Test',
    issuer: 'aevra:connector',
    audience: 'aevra',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  } as any);
  const workspaces: any = {
    listRemote: () => [{ id: ws.id, name: ws.name, description: '' }],
    getLocal: (idOrName: string) => wsRepo.get(idOrName) ?? wsRepo.getByName(idOrName),
    capabilityRoots: () => [],
  };
  const tools = new McpToolService(
    sessions,
    workspaces,
    {
      execute: async () => ({
        ok: false,
        error: { code: 'EXECUTOR_UNAVAILABLE', message: 'none' },
      }),
    } as any,
    { put() {} } as any,
    undefined,
    { connectorBindings: () => bindings },
  );
  return { db, session, tools, ws };
}
test('connector with profileCap is admitted at the cap, not the default mapping', async () => {
  const { db, session, tools, ws } = setup({ workspaceId: null, profileCap: 'read-only' });
  const r = await tools.call(session.id, 'workspace_select', { workspace: ws.id });
  assert.equal(r.status, 'selected');
  assert.deepEqual(r.capabilities, ['files.read', 'files.search', 'git.read']);
  db.close();
});
test('connector bound to another workspace is rejected', async () => {
  const { db, session, tools, ws } = setup({
    workspaceId: 'different-workspace',
    profileCap: null,
  });
  await assert.rejects(
    () => tools.call(session.id, 'workspace_select', { workspace: ws.id }),
    (e: any) => e.code === 'CAPABILITY_REQUIRED',
  );
  db.close();
});
test('non-connector actors ignore bindings entirely', async () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const wsRepo = new WorkspaceRepository(raw);
  const ws = wsRepo.create({ name: 'main', hostRoot: tmpdir() });
  const sessions = new SessionManager(
    new SessionRepository(raw),
    new CapabilityProfileService(raw),
  );
  const session = sessions.create({
    subject: 'sub',
    actor: 'human@example.test',
    issuer: 'i',
    audience: 'a',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  } as any);
  const workspaces: any = {
    listRemote: () => [],
    getLocal: (idOrName: string) => wsRepo.get(idOrName) ?? wsRepo.getByName(idOrName),
    capabilityRoots: () => [],
  };
  const tools = new McpToolService(
    sessions,
    workspaces,
    {
      execute: async () => ({
        ok: false,
        error: { code: 'EXECUTOR_UNAVAILABLE', message: 'none' },
      }),
    } as any,
    { put() {} } as any,
    undefined,
    { connectorBindings: () => ({ workspaceId: 'x', profileCap: 'read-only' }) },
  );
  const r = await tools.call(session.id, 'workspace_select', { workspace: ws.id });
  assert.equal(r.status, 'approval_required'); // no mapping for this actor and no override -> ask
  db.close();
});
