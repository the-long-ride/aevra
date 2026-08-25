import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function collect(root, pred) {
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      e.isDirectory() ? walk(f) : pred(f) && out.push(f);
    }
  };
  walk(root);
  return out.sort();
}
const suite = process.argv[2] ?? 'all';
const suffixes = {
  unit: '.unit.test.ts',
  contract: '.contract.test.ts',
  integration: '.integration.test.ts',
  security: '.security.test.ts',
};
const ts = [];
if (suite !== 'scripts') {
  for (const root of ['apps/cli', 'apps/core', 'apps/worker', 'packages', 'tests'])
    ts.push(
      ...collect(root, (f) => {
        if (!f.endsWith('.test.ts')) return false;
        if (suite === 'all' || suite === 'product') return true;
        const s = suffixes[suite];
        if (s && f.endsWith(s)) return true;
        return suite === 'unit' && !Object.values(suffixes).some((x) => f.endsWith(x));
      }),
    );
}
if (ts.length) {
  const out = '.test-dist';
  rmSync(out, { recursive: true, force: true });
  const c = spawnSync(
    'tsc',
    ['-p', 'tsconfig.json', '--noCheck', '--noEmit', 'false', '--outDir', out],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (c.status !== 0) process.exit(c.status ?? 1);
  const mapped = ts.map((f) => path.join(out, f).replace(/\.ts$/, '.js'));
  const r = spawnSync(process.execPath, ['--test', ...mapped], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (suite === 'all' || suite === 'scripts') {
  const js = collect('scripts/test', (f) => f.endsWith('.test.mjs'));
  if (js.length) {
    const r = spawnSync(process.execPath, ['--test', ...js], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
