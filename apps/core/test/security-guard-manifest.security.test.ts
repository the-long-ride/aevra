import assert from 'node:assert/strict';
import test from 'node:test';
import { SecurityGuard } from '../src/security/security-guard.js';

function sessions() {
  return {
    get: () => ({ id: 'ses_1', actor: 'oauth:ChatGPT', subject: 'grant_1' }),
    activeLease: () => ({ workspaceId: 'ws_1', capabilities: ['files.read', 'files.write'] }),
    isYolo: () => false,
  } as any;
}

const workspaces = {
  getLocal: () => ({ id: 'ws_1', name: 'Aevra', hostRoot: '/workspace' }),
} as any;

test('a manifest-declared secret pattern denies both read and write', () => {
  const guard = new SecurityGuard(sessions(), workspaces, {
    patternsFor: () => [{ pattern: /vendor\/keys\/.*/, class: 'SECRET', glob: 'vendor/keys/**' }],
  });
  for (const mutation of [true, false]) {
    const result = guard.authorizeResource({
      sessionId: 'ses_1',
      capability: mutation ? 'files.write' : 'files.read',
      operation: mutation ? 'write' : 'read',
      logicalPath: 'vendor/keys/id_rsa',
      mutation,
    });
    assert.equal(result.decision, 'deny');
    assert.equal(result.sensitivity, 'SECRET');
  }
});

test('a manifest-declared sensitive pattern requires approval on write, allows read', () => {
  const guard = new SecurityGuard(sessions(), workspaces, {
    patternsFor: () => [{ pattern: /.*\.local\..*/, class: 'SENSITIVE', glob: '**/*.local.*' }],
  });
  const write = guard.authorizeResource({
    sessionId: 'ses_1',
    capability: 'files.write',
    operation: 'write',
    logicalPath: 'settings.local.json',
    mutation: true,
  });
  assert.equal(write.decision, 'approval-required');
  const read = guard.authorizeResource({
    sessionId: 'ses_1',
    capability: 'files.read',
    operation: 'read',
    logicalPath: 'settings.local.json',
    mutation: false,
  });
  assert.equal(read.decision, 'allow');
});

test('a path matching both a secret and a sensitive pattern resolves to SECRET regardless of order', () => {
  const guard = new SecurityGuard(sessions(), workspaces, {
    patternsFor: () => [
      { pattern: /.*\.local\..*/, class: 'SENSITIVE', glob: '**/*.local.*' },
      { pattern: /vendor\/.*/, class: 'SECRET', glob: 'vendor/**' },
    ],
  });
  const result = guard.authorizeResource({
    sessionId: 'ses_1',
    capability: 'files.read',
    operation: 'read',
    logicalPath: 'vendor/settings.local.json',
    mutation: false,
  });
  assert.equal(result.sensitivity, 'SECRET');
  assert.equal(result.decision, 'deny');
});

test('a path matching no manifest pattern is unaffected', () => {
  const guard = new SecurityGuard(sessions(), workspaces, {
    patternsFor: () => [{ pattern: /vendor\/keys\/.*/, class: 'SECRET', glob: 'vendor/keys/**' }],
  });
  const result = guard.authorizeResource({
    sessionId: 'ses_1',
    capability: 'files.read',
    operation: 'read',
    logicalPath: 'src/index.ts',
    mutation: false,
  });
  assert.equal(result.decision, 'allow');
});

test('SecurityGuard with no manifests collaborator behaves exactly as before', () => {
  const guard = new SecurityGuard(sessions(), workspaces);
  const result = guard.authorizeResource({
    sessionId: 'ses_1',
    capability: 'files.read',
    operation: 'read',
    logicalPath: 'src/index.ts',
    mutation: false,
  });
  assert.equal(result.decision, 'allow');
});
