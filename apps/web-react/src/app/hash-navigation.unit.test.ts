import { expect, test } from 'vitest';
import { commitAdminNavigation, pageTokenFromHash } from './hash-navigation';

test('navigation updates page state synchronously before writing browser history', () => {
  const events: string[] = [];
  commitAdminNavigation(
    'settings',
    '#/dashboard',
    (page) => events.push(`state:${page}`),
    (hash) => events.push(`history:${hash}`),
  );
  expect(events).toEqual(['state:settings', 'history:#/settings']);
});

test('navigation still updates state when the URL already has the target hash', () => {
  const events: string[] = [];
  commitAdminNavigation(
    'settings',
    '#/settings',
    (page) => events.push(`state:${page}`),
    (hash) => events.push(`history:${hash}`),
  );
  expect(events).toEqual(['state:settings']);
});

test('page token parsing accepts hash routes and leaves validation to the hook', () => {
  expect(pageTokenFromHash('#/settings')).toBe('settings');
  expect(pageTokenFromHash('#/dashboard/details')).toBe('dashboard');
  expect(pageTokenFromHash('')).toBe('');
});
