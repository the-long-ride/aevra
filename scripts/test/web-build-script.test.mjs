import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const reactContracts = [
  'scripts/test/react-ui-source.test.mjs',
  'scripts/test/react-design-contract.test.mjs',
  'scripts/test/react-only-ui.test.mjs',
];

const browserSpecs = [
  'playwright.config.ts',
  'tests/ui-parity/static-server.mjs',
  'tests/ui-parity/fixtures.ts',
  'tests/ui-parity/navigation.spec.ts',
  'tests/ui-parity/dashboard.spec.ts',
  'tests/ui-parity/requests.spec.ts',
  'tests/ui-parity/tables.spec.ts',
  'tests/ui-parity/settings-guide.spec.ts',
  'tests/ui-parity/admin-actions.spec.ts',
  'tests/ui-parity/responsive.spec.ts',
  'tests/ui-parity/theme.spec.ts',
];

test('build emits React at the admin root and copies only manual assets afterward', () => {
  const build = pkg.scripts.build;
  assert.match(build, /apps\/web-react.*build|--prefix apps\/web-react run build/);
  assert.match(build, /node scripts\/copy-manual\.mjs/);
  assert.doesNotMatch(build, /copy-static|check-web-syntax|apps\/web(?:\s|\/)/);
  assert.ok(
    build.indexOf('apps/web-react') < build.indexOf('copy-manual.mjs'),
    'manual copy must happen after Vite emits the React root',
  );
});

test('web contracts are React-only', () => {
  const contracts = pkg.scripts['test:web:contracts'];
  for (const file of reactContracts) {
    assert.match(contracts, new RegExp(file.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(contracts, /web-modular|admin-surface-parity|apps\/web/);
  assert.match(pkg.scripts['test:web'], /test:web:contracts/);
  assert.match(pkg.scripts['test:web'], /apps\/web-react/);
});

test('web coverage requires 85 percent for every global metric', () => {
  assert.match(pkg.scripts['test:coverage'], /test-coverage-node\.mjs/);
  assert.match(pkg.scripts['test:coverage'], /test:coverage:web/);
  const vite = readFileSync('apps/web-react/vite.config.ts', 'utf8');
  const thresholds = { lines: 85, statements: 85, functions: 85, branches: 85 };
  for (const [metric, threshold] of Object.entries(thresholds)) {
    assert.match(vite, new RegExp(`${metric}:\\s*${threshold}`));
  }
});

test('React workspace participates in typecheck and browser regressions', () => {
  assert.deepEqual(pkg.workspaces, ['apps/web-react']);
  assert.match(pkg.scripts.typecheck, /tsconfig\.typecheck\.json/);
  assert.match(pkg.scripts.typecheck, /apps\/web-react/);
  assert.match(pkg.scripts['test:ui-parity'], /playwright test/);
  assert.ok(pkg.devDependencies['@playwright/test']);
  for (const file of browserSpecs) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
});
