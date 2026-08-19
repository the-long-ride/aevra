import assert from 'node:assert/strict';
import test from 'node:test';
import { commitAdminNavigation, pageTokenFromHash } from './hash-navigation.js';

test('navigation updates page state synchronously before writing browser history', () => {
  const events: string[] = [];
  commitAdminNavigation(
    'settings',
    '#/dashboard',
    (page) => events.push(`state:${page}`),
    (hash) => events.push(`history:${hash}`),
  );
  assert.deepEqual(events, ['state:settings', 'history:#/settings']);
});

test('navigation still updates state when the URL already has the target hash', () => {
  const events: string[] = [];
  commitAdminNavigation(
    'settings',
    '#/settings',
    (page) => events.push(`state:${page}`),
    (hash) => events.push(`history:${hash}`),
  );
  assert.deepEqual(events, ['state:settings']);
});

test('page token parsing accepts hash routes and leaves validation to the hook', () => {
  assert.equal(pageTokenFromHash('#/settings'), 'settings');
  assert.equal(pageTokenFromHash('#/dashboard/details'), 'dashboard');
  assert.equal(pageTokenFromHash(''), '');
});
