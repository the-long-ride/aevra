import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionRepository } from '../../store/src/permissions.js';
import { PermissionEngine } from '../../../apps/core/src/policy/permissions.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../store/src/database.js';
import { HostControlGrantRepository } from '../../store/src/host-control-grants.js';
import { WorkspaceRepository } from '../../store/src/workspaces.js';
import { SessionRepository } from '../../store/src/sessions.js';
import { WorkspaceService } from '../../../apps/core/src/workspaces/workspace-service.js';
import { CapabilityProfileService } from '../../../apps/core/src/policy/capabilities.js';
import { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import { ReadVersionCache } from '../../../apps/core/src/operations/read-version-cache.js';
import { HostControlAccess } from '../../../apps/core/src/control/host-control-access.js';
import { McpToolService } from '../src/service.js';

test('browser tools use host grant with zero workspaces and desktop remains separate', async () => {
  const db = AevraDatabase.open(':memory:');
  const workspaces = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const sessions = new SessionManager(
    new SessionRepository(db.raw()),
    new CapabilityProfileService(db.raw()),
  );
  const session = sessions.create({
    actor: 'local',
    subject: 'test',
    issuer: 'i',
    audience: 'a',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const access = new HostControlAccess(sessions, new HostControlGrantRepository(db.raw()));
  access.grant(access.identity(session.id)!, 'browser.control', 'admin');
  const calls: any[] = [];
  const tools = new McpToolService(
    sessions,
    workspaces,
    {
      execute: async (input: any) => {
        calls.push(input);
        return {
          ok: true,
          value:
            input.operation.kind === 'browser.tabs'
              ? [{ tabId: 't', url: 'https://example.test', active: true }]
              : { connected: false, transport: null, tabs: [], epoch: 1 },
        };
      },
    } as any,
    new ReadVersionCache(),
    undefined,
    { hostControlAccess: access } as any,
  );
  assert.deepEqual(await tools.call(session.id, 'control_access_status', {}), {
    identity: { kind: 'session', key: session.id },
    browser: true,
    desktop: false,
  });
  assert.equal((await tools.call(session.id, 'browser_status', {})).connected, false);
  await tools.call(session.id, 'browser_connect', { transport: 'extension' });
  await tools.call(session.id, 'browser_tabs', { action: 'list' });
  assert.equal(
    calls.every((call) => call.scope?.kind === 'host-control' && call.roots.length === 0),
    true,
  );
  await assert.rejects(
    () => tools.call(session.id, 'desktop_status', {}),
    (e: any) => e.code === 'APPROVAL_PENDING' || e.code === 'CAPABILITY_REQUIRED',
  );
  await assert.rejects(
    () => tools.call(session.id, 'file_read', { path: '/x' }),
    (e: any) => e.code === 'SESSION_WORKSPACE_REQUIRED',
  );
  db.close();
});

test('two workspace grants do not target host browser control and a global DENY still wins', async () => {
  const db = AevraDatabase.open(':memory:');
  const profiles = new CapabilityProfileService(db.raw());
  const sessions = new SessionManager(new SessionRepository(db.raw()), profiles);
  const workspaces = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const roots = [
    mkdtempSync(path.join(os.tmpdir(), 'aevra-host-one-')),
    mkdtempSync(path.join(os.tmpdir(), 'aevra-host-two-')),
  ];
  try {
    for (const [i, root] of roots.entries()) {
      const workspace = workspaces.create({ name: `W${i}`, hostRoot: root });
      profiles.mapActor('local', workspace.id, 'developer', 'auto');
    }
    const session = sessions.create({
      actor: 'local',
      subject: 'same',
      issuer: 'i',
      audience: 'a',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    for (const workspace of workspaces.listRemote())
      sessions.admitWorkspace(session.id, workspace.id);
    const access = new HostControlAccess(sessions, new HostControlGrantRepository(db.raw()));
    const calls: any[] = [];
    const permissions = new PermissionEngine(new PermissionRepository(db.raw()));
    const tools = new McpToolService(
      sessions,
      workspaces,
      {
        execute: async (input: any) => {
          calls.push(input);
          return { ok: true, value: { connected: false, transport: null, tabs: [], epoch: 1 } };
        },
      } as any,
      new ReadVersionCache(),
      undefined,
      {
        hostControlAccess: access,
        hostControlApproval: {
          requestHostControl: async () => ({ status: 'approval_pending', requestId: 'r' }),
        },
        permissions,
      } as any,
    );
    assert.deepEqual(await tools.call(session.id, 'browser_status', {}), {
      status: 'approval_pending',
      requestId: 'r',
      requiredCapability: 'browser.control',
      scope: 'host-control',
    });
    assert.equal(calls.length, 0);
    access.grant(access.identity(session.id)!, 'browser.control', 'admin');
    assert.equal(
      (await tools.call(session.id, 'browser_status', { workspaceId: 'obsolete' })).connected,
      false,
    );
    assert.equal(calls[0].workspaceId, '');
    await assert.rejects(
      () => tools.call(session.id, 'file_read', { path: '/x' }),
      (e: any) => e.code === 'WORKSPACE_REQUIRED',
    );
    new PermissionRepository(db.raw()).upsert({
      id: 'deny-browser',
      effect: 'deny',
      capability: 'browser.control',
      scope: 'global',
      actor: 'local',
      matcher: 'browser:status',
    });
    await assert.rejects(
      () => tools.call(session.id, 'browser_status', {}),
      (e: any) => e.code === 'CAPABILITY_REQUIRED',
    );
    assert.equal(calls.length, 1);
  } finally {
    db.close();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
