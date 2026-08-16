import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';

function make() {
  const db = AevraDatabase.open(':memory:');
  const workspace = new WorkspaceService(new WorkspaceRepository(db.raw())).create({
    name: 'Aevra',
    hostRoot: mkdtempSync(path.join(os.tmpdir(), 'aevra-session-')),
  });
  const profiles = new CapabilityProfileService(db.raw());
  const sessions = new SessionManager(new SessionRepository(db.raw()), profiles);
  return { db, workspace, profiles, sessions };
}

test('OAuth auto-admission remembers workspace and profile across MCP reconnect', async () => {
  const x = make();
  x.profiles.mapActor('oauth:ChatGPT', x.workspace.id, 'read-only', 'auto');
  const identity = {
    actor: 'oauth:ChatGPT',
    subject: 'grant-a',
    issuer: 'i',
    audience: 'a',
    expiresAt: 'x',
  };
  const first = x.sessions.create(identity);
  const admitted = await x.sessions.switchWorkspace(first.id, x.workspace.id);
  assert.equal(admitted.status, 'admitted');
  x.sessions.disconnect(first.id);
  const second = x.sessions.create(identity);
  assert.equal(x.sessions.activeLease(second.id)?.workspaceId, x.workspace.id);
  assert.deepEqual(
    x.sessions.activeLease(second.id)?.capabilities,
    x.profiles.get('read-only')?.capabilities,
  );
  x.db.close();
});

test('connection coding profile wins over a lower persistent mapping on reconnect', async () => {
  const x = make();
  x.profiles.mapActor('oauth:ChatGPT', x.workspace.id, 'read-only', 'auto');
  const identity = {
    actor: 'oauth:ChatGPT',
    subject: 'grant-b',
    issuer: 'i',
    audience: 'a',
    expiresAt: 'x',
  };
  const first = x.sessions.create(identity);
  await x.sessions.switchWorkspace(first.id, x.workspace.id);
  x.sessions.grantConnectionWorkspace(first.id, x.workspace.id, 'coding-session');
  x.sessions.disconnect(first.id);
  const second = x.sessions.create(identity);
  const lease = x.sessions.activeLease(second.id)!;
  assert.ok(lease.capabilities.includes('files.write'));
  assert.ok(lease.capabilities.includes('commands.run'));
  x.db.close();
});
