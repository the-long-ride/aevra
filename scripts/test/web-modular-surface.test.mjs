import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('apps/web/main.js', 'utf8');
const dashboard = readFileSync('apps/web/pages/dashboard.js', 'utf8');
const permissions = readFileSync('apps/web/pages/permissions.js', 'utf8');
const permissionBulk = readFileSync('apps/web/components/permission-bulk.js', 'utf8');
const sessions = readFileSync('apps/web/pages/sessions.js', 'utf8');
const requests = readFileSync('apps/web/components/request-drawer.js', 'utf8');
const requestActions = readFileSync('apps/web/components/request-actions.js', 'utf8');
const runtimeStatus = readFileSync('apps/web/components/runtime-status.js', 'utf8');
const table = readFileSync('apps/web/components/data-table.js', 'utf8');
const guide = readFileSync('apps/web/pages/guide.js', 'utf8');
const matcherCatalog = readFileSync('apps/web/data/safe-command-matchers.js', 'utf8');
const tokens = readFileSync('apps/web/styles/tokens.css', 'utf8');

test('modular shell exposes every supported admin destination and requests drawer', () => {
  for (const page of [
    'dashboard',
    'permissions',
    'workspaces',
    'sessions',
    'processes',
    'changes',
    'audit',
    'settings',
    'guide',
  ]) {
    assert.match(main, new RegExp(`['"]${page}['"]`));
  }
  assert.match(main, /openRequestDrawer/);
});

test('dashboard keeps Remote Access first inside Onboarding and completion ordering is state-driven', () => {
  const onboardingStart = dashboard.indexOf('class="onboarding-body"');
  const remote = dashboard.indexOf('data-onboarding-section="remote-access"');
  const connect = dashboard.indexOf('data-onboarding-section="connect-ai"');
  assert.ok(onboardingStart >= 0);
  assert.ok(remote > onboardingStart);
  assert.ok(connect > remote);
  assert.match(dashboard, /dashboardOrder\(onboarding\.completed\)/);
  assert.doesNotMatch(
    dashboard,
    /Remote Access remains visible above this section/,
  );
});

test('runtime shell keeps live version health and pending request count', () => {
  assert.match(runtimeStatus, /\/api\/status/);
  assert.match(runtimeStatus, /\/api\/approvals/);
  assert.match(runtimeStatus, /\/api\/oauth\/requests/);
  assert.match(runtimeStatus, /status\?\.version/);
  for (const key of ['core', 'worker', 'mcp', 'tunnel']) {
    assert.match(main, new RegExp(`data-health=.{0,3}${key}`));
  }
  assert.match(main, /requests-count/);
});

test('request drawer uses server presentation saved matcher and exact command scopes', () => {
  assert.match(requests, /item\.presentation/);
  assert.match(requests, /Saved matcher/);
  assert.match(requests, /permissionMatcher/);
  for (const label of [
    'Allow this session',
    'Always in workspace',
    'Always globally',
  ]) {
    assert.match(requestActions, new RegExp(label));
  }
  assert.match(requestActions, /risk === 'CRITICAL'/);
  assert.match(requests, /data-scope=/);
});

test('shared table supports search filters sort page size pagination and actions', () => {
  for (const marker of [
    'data-dt-search',
    'data-dt-filter',
    'data-dt-sort',
    'data-dt-size',
    'data-dt-page',
    'data-table-action',
  ]) {
    assert.match(table, new RegExp(marker));
  }
});

test('permissions and sessions retain searchable paginated filters', () => {
  for (const label of ['Effect', 'Capability', 'Scope', 'Connector / actor']) {
    assert.match(permissions, new RegExp(label.replace('/', '\\/')));
  }
  assert.match(permissionBulk, /Command matchers/);
  assert.match(permissionBulk, /\/api\/permissions\/bulk/);
  assert.match(sessions, /Actor/);
  assert.match(sessions, /Workspace state/);
  assert.match(sessions, /Search remote sessions/);
  assert.match(sessions, /Search admin sessions/);
});

test('safe matcher guide keeps platform tabs individual copy and Copy all', () => {
  assert.match(guide, /data-copy-all-matchers/);
  assert.match(guide, /data-copy-matcher/);
  assert.match(guide, /selectedPlatformMatchers/);
  assert.match(matcherCatalog, /git:status/);
  assert.match(matcherCatalog, /dotnet:test/);
});

test('scrollbars remain thin with transparent tracks', () => {
  assert.match(tokens, /scrollbar-width:\s*thin/);
  assert.match(tokens, /scrollbar-color:[^;]*transparent/);
  assert.match(tokens, /::-webkit-scrollbar\s*\{/);
  assert.match(tokens, /::-webkit-scrollbar-track/);
  assert.match(tokens, /background:\s*transparent/);
});
