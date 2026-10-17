import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

test('gateway workflows use Node 24 and GitHub-maintained v6 actions', () => {
  for (const name of readdirSync('.github/workflows').filter((n) => /\.ya?ml$/.test(n))) {
    const text = readFileSync(`.github/workflows/${name}`, 'utf8');
    for (const use of text.matchAll(/uses:\s+(actions\/[^\s]+)@(\S+)/g))
      assert.equal(use[2], 'v6', `${name}: ${use[1]}`);
    for (const version of text.matchAll(/node-version:\s*['"]?([^'"\s]+)/g))
      assert.equal(version[1], '24', name);
  }
  assert.equal(JSON.parse(readFileSync('package.json')).engines.node, '>=24.0.0');
  assert.equal(readFileSync('.node-version', 'utf8').trim(), '24');
  assert.equal(JSON.parse(readFileSync('package-lock.json')).packages[''].engines.node, '>=24.0.0');
});
