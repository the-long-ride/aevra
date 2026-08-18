import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const obsolete = [
  'apps/web/app.js',
  'apps/web/app-v2.js',
  'apps/web/app-v3.js',
  'apps/web/ui-runtime.js',
  'apps/web/admin-enhancements.js',
  'scripts/test/web-dashboard-v2.test.mjs',
  'scripts/test/web-dashboard-v3.test.mjs',
  'scripts/test/dashboard-onboarding-layout.test.mjs',
];

test('build syntax-checks the modular web tree instead of named legacy assets', () => {
  assert.match(pkg.scripts.build, /node scripts\/check-web-syntax\.mjs/);
  for (const file of obsolete) {
    assert.doesNotMatch(pkg.scripts.build, new RegExp(file.replaceAll('.', '\\.')));
  }
});

test('web test script runs modular contracts without deleted v2 v3 tests', () => {
  for (const file of [
    'scripts/test/web-modular-entry.test.mjs',
    'scripts/test/web-modular-surface.test.mjs',
    'scripts/test/web-admin-shell.test.mjs',
    'scripts/test/web-admin-enhancements.test.mjs',
    'scripts/test/web-permission-exact.test.mjs',
    'scripts/test/safe-command-guide.test.mjs',
    'scripts/test/web-toast-single.test.mjs',
    'scripts/test/web-onboarding-runtime.test.mjs',
  ]) {
    assert.match(pkg.scripts['test:web'], new RegExp(file.replaceAll('.', '\\.')));
  }
  for (const file of obsolete) {
    assert.doesNotMatch(pkg.scripts['test:web'], new RegExp(file.replaceAll('.', '\\.')));
  }
});
