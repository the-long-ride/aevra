import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { HostControlGrantRepository } from '../../../packages/store/src/host-control-grants.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { createCoreToolService } from '../src/admin/admin-api-context.js';
import { HostControlAccess } from '../src/control/host-control-access.js';
import { ReadVersionCache } from '../src/operations/read-version-cache.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';

test('core tool composition exposes saved browser pairing through browser_status', async () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const sessions = new SessionManager(
      new SessionRepository(db.raw()),
      new CapabilityProfileService(db.raw()),
    );
    const workspaces = new WorkspaceService(new WorkspaceRepository(db.raw()));
    const session = sessions.create({
      actor: 'local',
      subject: 'test',
      issuer: 'i',
      audience: 'a',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const hostControlAccess = new HostControlAccess(
      sessions,
      new HostControlGrantRepository(db.raw()),
    );
    hostControlAccess.grant(hostControlAccess.identity(session.id)!, 'browser.control', 'admin');
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
    const tools = createCoreToolService(
      sessions,
      workspaces,
      { execute: async () => assert.fail('pairingHealth owns this status request') },
      new ReadVersionCache(),
      undefined,
      {
        hostControlAccess,
        browserPairing: {
          epoch: () => 7,
          pairedExtensionId: () => extensionId,
          pairingHealth: async () => ({
            coreExtensionId: extensionId,
            coreEpoch: 7,
            worker: null,
            syncErrorCode: 'WORKER_UNAVAILABLE',
            syncCheckedAt: '2026-09-25T00:00:00Z',
          }),
        },
      },
    );

    const status = await tools.call(session.id, 'browser_status', {});
    assert.equal(status.extensionPaired, true);
    assert.equal(status.extensionId, extensionId);
    assert.equal(status.epoch, 7);
    assert.equal(status.syncErrorCode, 'WORKER_UNAVAILABLE');
  } finally {
    db.close();
  }
});
