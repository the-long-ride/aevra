import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
function files(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      e.isDirectory() ? walk(f) : /\.(?:ts|js)$/.test(f) && out.push(f);
    }
  };
  walk(root);
  return out;
}
function combined(root) {
  return files(root)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}
test('architecture import boundaries stay one-way', () => {
  const mcp = combined('packages/mcp-tools/src'),
    web = combined('apps/web'),
    worker = combined('apps/worker/src');
  assert.doesNotMatch(mcp, /packages\/executor|\.\.\/executor/);
  assert.doesNotMatch(web, /packages\/ipc|apps\/worker|worker-manager/);
  assert.doesNotMatch(worker, /apps\/core|packages\/store|admin\/|policy\//);
});
test('Core workspace operation service does not execute child processes directly', () => {
  const operation = readFileSync('apps/core/src/operations/operation-service.ts', 'utf8');
  assert.doesNotMatch(operation, /node:child_process|\bspawn\s*\(/);
});
