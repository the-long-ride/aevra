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

test('navigation and dashboard section ordering are stable', () => {
  assert.deepEqual(
    ADMIN_SURFACE.navigation.map((item) => item.id),
    [
      'dashboard',
      'workspaces',
      'permissions',
      'sessions',
      'audit',
      'settings',
      'data',
      'guide',
      'about',
    ],
  );
  assert.deepEqual(ADMIN_SURFACE.dashboardSections, [
    'runtime-overview',
    'live-mcp-activity',
    'active-connections',
    'system-capabilities',
  ]);
  assert.equal('onboarding' in ADMIN_SURFACE, false);
});

test('approval scopes include every persistent choice after once', () => {
  assert.deepEqual(ADMIN_SURFACE.approvalScopes, [
    'once',
    'session',
    'workspace',
    'global',
    'connection',
  ]);
});

test('surface ids are implementation-neutral stable selectors', () => {
  assert.equal(surfaceId('page', 'dashboard'), 'page:dashboard');
  assert.equal(surfaceId('requests', 'approve-global'), 'requests:approve-global');
});
