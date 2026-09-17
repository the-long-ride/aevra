import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('apps/core never imports packages/browser', () => {
  const offenders = sources(path.join(root, 'apps/core/src')).filter((file) =>
    /from\s+'[^']*packages\/browser\//.test(readFileSync(file, 'utf8')),
  );
  assert.deepEqual(offenders, []);
});

test('packages/browser never imports apps/core', () => {
  const offenders = sources(path.join(root, 'packages/browser/src')).filter((file) =>
    /from\s+'[^']*apps\/core\//.test(readFileSync(file, 'utf8')),
  );
  assert.deepEqual(offenders, []);
});

test('nothing under packages/ references chrome or DOM globals', () => {
  const offenders = sources(path.join(root, 'packages')).filter((file) =>
    /\bchrome\.[a-z]|\bdocument\.|\bwindow\./.test(readFileSync(file, 'utf8')),
  );
  assert.deepEqual(offenders, []);
});

test('no source file exposes a page-script evaluation tool', () => {
  const offenders = [
    ...sources(path.join(root, 'packages')),
    ...sources(path.join(root, 'apps/core/src')),
    ...sources(path.join(root, 'apps/worker/src')),
  ].filter((file) => /browser[_.]evaluate/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});
