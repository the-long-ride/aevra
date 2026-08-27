import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEST_RUN_TIMEOUT_MS = 120_000;

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

function runNodeTests(files, label) {
  console.error(`[test] ${label}: ${files.length} files`);
  const result = spawnSync(process.execPath, ['--test', ...files], {
    stdio: 'inherit',
    timeout: TEST_RUN_TIMEOUT_MS,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    console.error(
      `[test] ${label} timed out after ${TEST_RUN_TIMEOUT_MS}ms. Suspect files:\n${files.join('\n')}`,
    );
    process.exit(1);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
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
  runNodeTests(mapped, `Node ${suite} suite`);
}
if (suite === 'all' || suite === 'scripts') {
  const js = collect('scripts/test', (f) => f.endsWith('.test.mjs'));
  if (js.length) runNodeTests(js, 'script suite');
}
