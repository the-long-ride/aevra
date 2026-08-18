import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveTableRows } from '../components/data-table-state.js';
import { approvalActions } from '../components/request-actions.js';
import { selectedPlatformMatchers } from '../data/safe-command-matchers.js';
import { dashboardOrder } from '../pages/dashboard-order.js';

test('dashboard order puts onboarding first until complete and last after completion', () => {
  assert.equal(dashboardOrder(false)[0], 'onboarding');
  assert.equal(dashboardOrder(true).at(-1), 'onboarding');
});

test('critical approval only allows deny and once', () => {
  assert.deepEqual(
    approvalActions({ risk: 'CRITICAL', command: true }).map(
      (item) => item.scope,
    ),
    [null, 'once'],
  );
  assert.deepEqual(
    approvalActions({ risk: 'HIGH', command: true }).map(
      (item) => item.scope,
    ),
    [null, 'once', 'session', 'workspace', 'global'],
  );
});

test('data table derives filtered sorted paged rows', () => {
  const rows = [
    { id: 'a', name: 'Zulu', effect: 'deny' },
    { id: 'b', name: 'Alpha', effect: 'allow' },
    { id: 'c', name: 'Beta', effect: 'allow' },
  ];
  const result = deriveTableRows(
    rows,
    {
      query: 'a',
      filters: { effect: 'allow' },
      sortKey: 'name',
      sortDir: 'asc',
      page: 1,
      pageSize: 1,
    },
    [{ key: 'name' }, { key: 'effect' }],
    [{ key: 'effect' }],
  );
  assert.equal(result.filtered.length, 2);
  assert.deepEqual(
    result.pageRows.map((row) => row.id),
    ['b'],
  );
  assert.equal(result.pageCount, 2);
});

test('safe matcher copy-all uses selected platform only', () => {
  const catalog = [
    { matcher: 'git:status', platforms: ['windows', 'linux'] },
    { matcher: 'pwsh:*', platforms: ['windows'] },
    { matcher: 'bash:*', platforms: ['linux'] },
  ];
  assert.deepEqual(selectedPlatformMatchers(catalog, 'windows'), [
    'git:status',
    'pwsh:*',
  ]);
});
