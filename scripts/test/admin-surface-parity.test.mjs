import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(
  readFileSync('packages/admin-contracts/admin-surface.json', 'utf8'),
);
const vanillaMain = readFileSync('apps/web/main.js', 'utf8');
const reactApp = readFileSync('apps/web-react/src/app/App.tsx', 'utf8');
const vanillaDashboard = readFileSync('apps/web/pages/dashboard-view.js', 'utf8');
const reactDashboard = readFileSync(
  'apps/web-react/src/features/dashboard/DashboardPage.tsx',
  'utf8',
);
const vanillaActions = readFileSync(
  'apps/web/components/request-actions.js',
  'utf8',
);
const reactActions = readFileSync(
  'apps/web-react/src/features/requests/request-actions.ts',
  'utf8',
);

function matcherNames(path) {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(/matcher:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .sort();
}

test('vanilla and React expose every shared navigation destination', () => {
  for (const item of manifest.navigation) {
    assert.match(vanillaMain, new RegExp(`['"]${item.id}['"]`));
    assert.match(reactApp, new RegExp(`${item.id}|${item.label}`));
  }
});

test('both Dashboards keep Remote Access first in Onboarding and support completed-bottom ordering', () => {
  assert.equal(manifest.onboarding.beforeCompletion[0], 'remote-access');
  assert.equal(manifest.onboarding.completedPosition, 'bottom');
  for (const source of [vanillaDashboard, reactDashboard]) {
    for (const section of manifest.onboarding.beforeCompletion) {
      assert.match(source, new RegExp(section.replaceAll('-', '[- ]')));
    }
  }
  assert.match(reactDashboard, /dashboardOrder\(data\.onboarding\.completed\)/);
});

test('both request implementations expose the same remembered command scopes', () => {
  assert.deepEqual(manifest.approvalScopes, [
    'once',
    'session',
    'workspace',
    'global',
  ]);
  for (const label of [
    'Run once',
    'Allow this session',
    'Always in workspace',
    'Always globally',
  ]) {
    assert.match(vanillaActions, new RegExp(label));
    assert.match(reactActions, new RegExp(label));
  }
  assert.match(vanillaActions, /CRITICAL/);
  assert.match(reactActions, /CRITICAL/);
});

test('vanilla and React Safe Matcher catalogs contain the same matcher identities', () => {
  assert.deepEqual(
    matcherNames('apps/web/data/safe-command-matchers.js'),
    matcherNames('apps/web-react/src/features/guide/safe-command-matchers.ts'),
  );
});
