import assert from 'node:assert/strict';
import test from 'node:test';
import { nextTheme, resolveInitialTheme } from './theme-state.js';

test('stored Aevra theme wins over the operating-system preference', () => {
  assert.equal(resolveInitialTheme('light', true), 'light');
  assert.equal(resolveInitialTheme('dark', false), 'dark');
});

test('system preference is used when the stored value is missing or invalid', () => {
  assert.equal(resolveInitialTheme(null, true), 'dark');
  assert.equal(resolveInitialTheme(undefined, false), 'light');
  assert.equal(resolveInitialTheme('sepia', true), 'dark');
});

test('theme toggle switches only between light and dark', () => {
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
});
