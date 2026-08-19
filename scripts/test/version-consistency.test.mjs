import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
test('version constant matches package.json', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const src = readFileSync('apps/core/src/version.ts', 'utf8');
  const m = src.match(/AEVRA_VERSION\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'version constant found');
  assert.equal(
    m[1],
    pkg.version,
    `apps/core/src/version.ts (${m[1]}) must match package.json (${pkg.version})`,
  );
});
