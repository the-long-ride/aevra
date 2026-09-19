import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOperationEnvelope } from '../src/worker.js';
import type { BackgroundActionInput } from '../src/desktop.js';

const baseEnvelope = {
  version: 1 as const,
  daemonInstanceId: 'daemon-1',
  operationId: 'op-1',
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 10_000).toISOString(),
  nonce: 'nonce-1',
  executionMode: 'host' as const,
  capabilityRoots: [],
  mac: 'mac-1',
};

test('desktop.backgroundAct accepts valid invoke, select, toggle and setValue actions', () => {
  const actions: BackgroundActionInput[] = [
    {
      windowId: 'win-1',
      snapshotId: 'snap-1',
      windowLeaseId: 'lease-1',
      ref: 'ref-1',
      op: 'invoke',
    },
    {
      windowId: 'win-1',
      snapshotId: 'snap-1',
      windowLeaseId: 'lease-1',
      ref: 'ref-1',
      op: 'select',
    },
    {
      windowId: 'win-1',
      snapshotId: 'snap-1',
      windowLeaseId: 'lease-1',
      ref: 'ref-1',
      op: 'toggle',
    },
    {
      windowId: 'win-1',
      snapshotId: 'snap-1',
      windowLeaseId: 'lease-1',
      ref: 'ref-1',
      op: 'setValue',
      value: 'Hello World',
    },
  ];

  for (const action of actions) {
    const envelope = parseOperationEnvelope({
      ...baseEnvelope,
      operation: {
        kind: 'desktop.backgroundAct',
        action,
        policy: { mode: 'allowlist', applications: [], unattributedInput: 'deny' },
      },
    });
    assert.equal(envelope.version, 1);
  }
});

test('desktop.releaseWindow requires windowId and windowLeaseId', () => {
  const envelope = parseOperationEnvelope({
    ...baseEnvelope,
    operation: {
      kind: 'desktop.releaseWindow',
      windowId: 'win-1',
      windowLeaseId: 'lease-1',
    },
  });
  assert.equal(envelope.version, 1);
});

test('desktop.describe accepts optional mode foreground and background', () => {
  const fg = parseOperationEnvelope({
    ...baseEnvelope,
    operation: {
      kind: 'desktop.describe',
      maxNodes: 100,
      interactiveOnly: false,
      mode: 'foreground',
    },
  });
  assert.equal(fg.version, 1);

  const bg = parseOperationEnvelope({
    ...baseEnvelope,
    operation: {
      kind: 'desktop.describe',
      windowId: 'win-1',
      maxNodes: 100,
      interactiveOnly: false,
      mode: 'background',
      policy: { mode: 'allowlist', applications: [], unattributedInput: 'deny' },
    },
  });
  assert.equal(bg.version, 1);
});

test('capability defaults absent backgroundActions to false for old-helper compatibility', async () => {
  const { normalizeBackgroundCapability } = await import(
    '../../desktop/src/background-driver.js'
  );
  assert.equal(
    normalizeBackgroundCapability({
      capture: true,
      tree: true,
      attribution: true,
      input: true,
    }),
    false,
  );
  assert.equal(
    normalizeBackgroundCapability({
      capture: true,
      tree: true,
      attribution: true,
      input: true,
      backgroundActions: true,
    }),
    true,
  );
});
