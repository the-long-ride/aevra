import assert from 'node:assert/strict';
import test from 'node:test';
import { SecurityGuard } from '../src/security/security-guard.js';

function sessions(yolo = false) {
  return {
    get: () => ({ id: 'ses_1', actor: 'oauth:ChatGPT', subject: 'grant_1' }),
    activeLease: () => ({ workspaceId: 'ws_1', capabilities: ['files.read', 'files.write'] }),
    isYolo: () => yolo,
  } as any;
}

const workspaces = {
  getLocal: () => ({ id: 'ws_1', name: 'Aevra', hostRoot: '/workspace' }),
} as any;

test('SECRET resources are denied even in YOLO', () => {
  const guard = new SecurityGuard(sessions(true), workspaces);
  for (const operation of ['read', 'search', 'write', 'patch', 'move', 'delete'] as const) {
    const decision = guard.authorizeResource({
      sessionId: 'ses_1',
      capability: operation === 'read' || operation === 'search' ? 'files.read' : 'files.write',
      operation,
      logicalPath: '/.env',
      mutation: !['read', 'search'].includes(operation),
    });
    assert.equal(decision.sensitivity, 'SECRET');
    assert.equal(decision.decision, 'deny');
  }
});

test('SENSITIVE reads remain allowed for masking but mutations force one-time approval', () => {
  const guard = new SecurityGuard(sessions(true), workspaces);
  const read = guard.authorizeResource({
    sessionId: 'ses_1',
    capability: 'files.read',
    operation: 'read',
    logicalPath: '/.npmrc',
    mutation: false,
  });
  assert.equal(read.sensitivity, 'SENSITIVE');
  assert.equal(read.decision, 'allow');

  const write = guard.authorizeResource({
    sessionId: 'ses_1',
    capability: 'files.write',
    operation: 'write',
    logicalPath: '/.npmrc',
    mutation: true,
  });
  assert.equal(write.sensitivity, 'SENSITIVE');
  assert.equal(write.decision, 'approval-required');
  assert.equal(write.approvalScope, 'once');
});

test('NORMAL resources preserve ordinary capability policy', () => {
  const guard = new SecurityGuard(sessions(false), workspaces);
  const result = guard.authorizeResource({
    sessionId: 'ses_1',
    capability: 'files.read',
    operation: 'read',
    logicalPath: '/src/index.ts',
    mutation: false,
  });
  assert.equal(result.sensitivity, 'NORMAL');
  assert.equal(result.decision, 'allow');
  assert.equal(result.workspaceId, 'ws_1');
});
