import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const toast = readFileSync('apps/web/components/toast.js', 'utf8');
const css = readFileSync('apps/web/styles/components.css', 'utf8');
const permissions = readFileSync('apps/web/pages/permissions.js', 'utf8');
const settings = readFileSync('apps/web/pages/settings.js', 'utf8');

test('modular web UI ships one shared toast implementation', () => {
  assert.match(toast, /export function toast/);
  assert.match(toast, /toast-stack/);
  assert.match(permissions, /from ['"]\.\.\/components\/toast\.js['"]/);
  assert.match(settings, /from ['"]\.\.\/components\/toast\.js['"]/);
  assert.doesNotMatch(permissions, /function toast\s*\(/);
  assert.doesNotMatch(settings, /function toast\s*\(/);
});

test('toast stack remains bottom-right and permission mutations report success', () => {
  assert.match(css, /\.toast-stack\s*\{[^}]*bottom:\s*16px/s);
  assert.match(css, /\.toast-stack\s*\{[^}]*right:\s*16px/s);
  assert.doesNotMatch(css, /\.toast-stack\s*\{[^}]*top:/s);
  assert.match(permissions, /toast\(['"]Permission revoked['"],\s*['"]success['"]\)/);
});
