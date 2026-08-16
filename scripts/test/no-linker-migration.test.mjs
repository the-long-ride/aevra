import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const roots = ['apps', 'packages', 'docs', 'README.md'];
const ignoredPrefixes = [
  path.normalize('docs/superpowers/'),
  path.normalize('docs/user-manual/11-troubleshooting.md'),
];
const forbidden = [
  /migrated-from-linker/i,
  /migrate-from-linker/i,
  /rekeyLegacySecrets/,
  /removeLegacy/,
  /stop-with-linker/i,
  /legacy\s+Linker\s+migration/i,
  /Linker→Aevra\s+migration/i,
  /migration\s+from\s+Linker/i,
  /old\s+Linker\s+state/i,
  /legacy\s+`?linker`?\s+service/i,
];

function filesUnder(target) {
  if (!existsSync(target)) return [];
  const statPath = path.normalize(target);
  if (!readdirSafe(target)) return [target];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const normalized = path.normalize(full);
      if (ignoredPrefixes.some((prefix) => normalized.startsWith(prefix))) continue;
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(target);
  return out;
}
function readdirSafe(target) {
  try {
    return readdirSync(target, { withFileTypes: true });
  } catch {
    return null;
  }
}

test('active code and docs contain no Linker migration compatibility', () => {
  const offenders = [];
  for (const root of roots) {
    for (const file of filesUnder(root)) {
      if (!/\.(?:ts|js|mjs|md)$/.test(file) && file !== 'README.md') continue;
      const text = readFileSync(file, 'utf8');
      for (const pattern of forbidden)
        if (pattern.test(text)) {
          offenders.push(`${file}: ${pattern}`);
          break;
        }
    }
  }
  assert.deepEqual(offenders, []);
});
