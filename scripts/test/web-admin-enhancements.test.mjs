import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const permissions = readFileSync('apps/web/pages/permissions.js', 'utf8');
const permissionBulk = readFileSync(
  'apps/web/components/permission-bulk.js',
  'utf8',
);
const workspaces = readFileSync('apps/web/pages/workspaces.js', 'utf8');
const workspaceDetail = readFileSync(
  'apps/web/components/workspace-detail.js',
  'utf8',
);
const sessions = readFileSync('apps/web/pages/sessions.js', 'utf8');
const audit = readFileSync('apps/web/pages/audit.js', 'utf8');
const settings = readFileSync('apps/web/pages/settings.js', 'utf8');
const table = readFileSync('apps/web/components/data-table.js', 'utf8');

test('shared admin DataTable keeps search filters pagination and row actions', () => {
  for (const marker of [
    'data-dt-search',
    'data-dt-filter',
    'data-dt-size',
    'data-dt-page',
    'data-table-action',
  ]) {
    assert.match(table, new RegExp(marker));
  }
  assert.match(table, /pageSizes\s*\?\?/);
  assert.match(table, /\[10, 25, 50, 100\]/);
});

test('permission bulk editor retains guided targeting and command matcher controls', () => {
  for (const text of [
    'Who gets access?',
    'Where does it apply?',
    'What can they do?',
    'Rule details',
    'Select all',
    'Clear',
    'Create 0 rules',
    'All connectors',
    'Selected connectors',
  ]) {
    assert.match(permissionBulk, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.doesNotMatch(permissionBulk, /Selected connected connectors/i);
  assert.match(permissionBulk, /\/api\/permissions\/bulk/);
  assert.match(permissionBulk, /Command matchers/);
  assert.match(permissionBulk, /Broad command access/);
});

test('Permissions uses the shared table and retains all requested filters', () => {
  assert.match(permissions, /mountDataTable/);
  assert.match(permissions, /id:\s*'permissions-admin'/);
  assert.match(permissions, /Search permissions/);
  for (const label of ['Effect', 'Capability', 'Scope', 'Connector / actor']) {
    assert.match(permissions, new RegExp(label.replace('/', '\\/')));
  }
  assert.match(permissions, /Permission revoked/);
});

test('Workspaces uses shared pagination search and external mount management', () => {
  assert.match(workspaces, /mountDataTable/);
  assert.match(workspaces, /id:\s*'workspaces-admin'/);
  assert.match(workspaces, /Search workspaces/);
  assert.match(workspaces, /External mounts/);
  assert.match(workspaces, /Details/);
  assert.match(workspaces, /Remove/);
  assert.match(workspaceDetail, /\/mounts/);
  assert.match(workspaceDetail, /\/admission/);
  assert.match(workspaceDetail, /Danger zone/);
});

test('Sessions keeps remote Actor and Workspace state filters plus local-session search', () => {
  assert.match(sessions, /id:\s*'remote-sessions-admin'/);
  assert.match(sessions, /Search remote sessions/);
  assert.match(sessions, /Actor/);
  assert.match(sessions, /Workspace state/);
  assert.match(sessions, /id:\s*'local-sessions-admin'/);
  assert.match(sessions, /Search admin sessions/);
  assert.match(sessions, /Revoke all others/);
});

test('Audit keeps integrity export search and destructive clear confirmation', () => {
  assert.match(audit, /\/api\/audit\/verify/);
  assert.match(audit, /format=jsonl/);
  assert.match(audit, /Filter actor, operation, or target/);
  assert.match(audit, /Clear history/);
  assert.match(audit, /Permanently clear all audit event history/);
});

test('Settings keeps execution policy network environment secrets and Cloudflare controls', () => {
  for (const endpoint of [
    '/api/execution-settings',
    '/api/policy/command-families',
    '/api/policy/network-rules',
    '/api/environment-profiles',
    '/api/secret-references',
  ]) {
    assert.match(settings, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
});
