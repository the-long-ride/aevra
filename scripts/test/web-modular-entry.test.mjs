import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('apps/web/index.html', 'utf8');

const obsoleteEntries = [
  'app.js',
  'app-v2.js',
  'app-v3.js',
  'ui-runtime.js',
  'admin-enhancements.js',
  'dashboard-onboarding-layout.js',
  'data-table.js',
  'safe-command-matchers.js',
];

const obsoleteStyles = [
  'app.css',
  'app-v2.css',
  'app-v3.css',
  'admin-enhancements.css',
];

test('vanilla UI loads one modular application entry', () => {
  assert.match(html, /<script type="module" src="\/main\.js"><\/script>/);
  for (const entry of obsoleteEntries) {
    assert.doesNotMatch(html, new RegExp(`src=["'][^"']*${entry.replaceAll('.', '\\.')}`));
  }
});

test('vanilla UI uses focused maintainable style sheets', () => {
  for (const file of [
    'styles/tokens.css',
    'styles/shell.css',
    'styles/components.css',
    'styles/dashboard.css',
    'styles/admin.css',
    'styles/requests.css',
  ]) {
    assert.match(html, new RegExp(file.replaceAll('.', '\\.')));
  }
  for (const file of obsoleteStyles) {
    assert.doesNotMatch(html, new RegExp(`href=["'][^"']*${file.replaceAll('.', '\\.')}`));
  }
});
