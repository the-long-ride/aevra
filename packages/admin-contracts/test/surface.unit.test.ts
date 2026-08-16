import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ADMIN_SURFACE, surfaceId } from '../src/surface.js';

const manifest = JSON.parse(
  readFileSync(path.resolve('packages/admin-contracts/admin-surface.json'), 'utf8'),
);

test('typed contract matches the JSON parity manifest', () => {
  assert.deepEqual(ADMIN_SURFACE, manifest);
});

test('navigation and onboarding ordering are stable', () => {
  assert.deepEqual(
    ADMIN_SURFACE.navigation.map((item) => item.id),
    ['dashboard', 'workspaces', 'permissions', 'sessions', 'audit', 'settings', 'guide'],
  );
  assert.deepEqual(ADMIN_SURFACE.dashboardSections, [
    'onboarding',
    'runtime-overview',
    'live-mcp-activity',
    'active-connections',
  ]);
  assert.deepEqual(ADMIN_SURFACE.onboarding.beforeCompletion, [
    'remote-access',
    'connect-ai',
    'workspace',
    'try-aevra',
    'finish-onboarding',
  ]);
  assert.equal(ADMIN_SURFACE.onboarding.completedPosition, 'bottom');
});

test('approval scopes include every persistent choice after once', () => {
  assert.deepEqual(ADMIN_SURFACE.approvalScopes, ['once', 'session', 'workspace', 'global']);
});

test('surface ids are implementation-neutral stable selectors', () => {
  assert.equal(surfaceId('page', 'dashboard'), 'page:dashboard');
  assert.equal(surfaceId('requests', 'approve-global'), 'requests:approve-global');
});
