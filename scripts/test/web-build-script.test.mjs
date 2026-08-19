import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

const modularContracts = [
  'scripts/test/web-modular-entry.test.mjs',
  'scripts/test/web-modular-surface.test.mjs',
  'scripts/test/web-admin-shell.test.mjs',
  'scripts/test/web-admin-enhancements.test.mjs',
  'scripts/test/web-permission-exact.test.mjs',
  'scripts/test/safe-command-guide.test.mjs',
  'scripts/test/web-toast-single.test.mjs',
  'scripts/test/web-onboarding-runtime.test.mjs',
  'scripts/test/admin-surface-parity.test.mjs',
  'scripts/test/react-ui-source.test.mjs',
];

const paritySpecs = [
  'playwright.config.ts',
  'tests/ui-parity/static-server.mjs',
  'tests/ui-parity/fixtures.ts',
  'tests/ui-parity/navigation.spec.ts',
  'tests/ui-parity/dashboard.spec.ts',
  'tests/ui-parity/requests.spec.ts',
  'tests/ui-parity/tables.spec.ts',
  'tests/ui-parity/settings-guide.spec.ts',
];

test('build syntax-checks modular vanilla UI then copies it before React Vite output', () => {
  const build = pkg.scripts.build;
  assert.match(build, /node scripts\/check-web-syntax\.mjs/);
  assert.match(build, /node scripts\/copy-static\.mjs/);
  assert.match(build, /apps\/web-react.*build|--prefix apps\/web-react run build/);
  assert.ok(
    build.indexOf('node scripts/copy-static.mjs') < build.indexOf('apps/web-react'),
    'copy-static must run before React build so the React output is not deleted',
  );
  for (const file of obsolete) {
    assert.doesNotMatch(build, new RegExp(file.replaceAll('.', '\\.')));
  }
});

test('web tests combine modular vanilla contracts with React tests', () => {
  const contracts = pkg.scripts['test:web:contracts'];
  for (const file of modularContracts) {
    assert.match(contracts, new RegExp(file.replaceAll('.', '\\.')));
  }
  for (const file of obsolete) {
    assert.doesNotMatch(contracts, new RegExp(file.replaceAll('.', '\\.')));
  }
  assert.match(pkg.scripts['test:web'], /test:web:contracts/);
  assert.match(pkg.scripts['test:web'], /vitest\.web\.config\.ts/);
});

test('web coverage runs the shared vanilla and React Vitest configuration at 85 percent', () => {
  assert.match(pkg.scripts['test:coverage'], /test-coverage-node\.mjs/);
  assert.match(pkg.scripts['test:coverage'], /test:coverage:web/);
  assert.match(pkg.scripts['test:coverage:web'], /vitest\.web\.config\.ts/);
  const config = readFileSync('vitest.web.config.ts', 'utf8');
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    assert.match(config, new RegExp(`${metric}:\\s*85`));
  }
});

test('React workspace participates in typecheck and the root package exposes Playwright parity', () => {
  assert.deepEqual(pkg.workspaces, ['apps/web-react']);
  assert.match(pkg.scripts.typecheck, /tsconfig\.typecheck\.json/);
  assert.match(pkg.scripts.typecheck, /apps\/web-react/);
  assert.match(pkg.scripts['test:ui-parity'], /playwright test/);
  assert.ok(pkg.devDependencies['@playwright/test']);
  for (const file of paritySpecs) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
});
