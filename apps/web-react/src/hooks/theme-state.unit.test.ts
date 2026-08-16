import { expect, test } from 'vitest';
import { nextTheme, resolveInitialTheme } from './theme-state';

test('stored Aevra theme wins over the operating-system preference', () => {
  expect(resolveInitialTheme('light', true)).toBe('light');
  expect(resolveInitialTheme('dark', false)).toBe('dark');
});

test('system preference is used when the stored value is missing or invalid', () => {
  expect(resolveInitialTheme(null, true)).toBe('dark');
  expect(resolveInitialTheme(undefined, false)).toBe('light');
  expect(resolveInitialTheme('sepia', true)).toBe('dark');
});

test('theme toggle switches only between light and dark', () => {
  expect(nextTheme('light')).toBe('dark');
  expect(nextTheme('dark')).toBe('light');
});
