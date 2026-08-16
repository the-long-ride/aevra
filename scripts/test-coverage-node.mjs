import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const output = path.join(root, '.coverage-dist');
const rawCoverage = path.join(root, '.coverage-v8');
const TEST_BATCH_SIZE = 20;

// Resolve local tool entries so every child spawns as `node <entry>` without
// a shell. Coverage tests are also executed in bounded batches because Windows
// has a strict process command-line limit that the repository can outgrow.
const toolEntries = {
  tsc: path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  c8: path.join(root, 'node_modules', 'c8', 'bin', 'c8.js'),
};

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function testFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...testFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(full);
    }
  }
  return files.sort();
}

rmSync(output, { recursive: true, force: true });
rmSync(rawCoverage, { recursive: true, force: true });
command(process.execPath, [toolEntries.tsc, '-p', 'tsconfig.coverage.json']);

const tests = [
  ...testFiles(path.join(output, 'apps')),
  ...testFiles(path.join(output, 'packages')),
  ...testFiles(path.join(output, 'tests')),
];

if (tests.length === 0) {
  console.error('No compiled Node tests found for coverage.');
  process.exit(1);
}

for (let start = 0; start < tests.length; start += TEST_BATCH_SIZE) {
  command(process.execPath, ['--test', ...tests.slice(start, start + TEST_BATCH_SIZE)], {
    env: { ...process.env, NODE_V8_COVERAGE: rawCoverage },
  });
}

command(process.execPath, [
  toolEntries.c8,
  'report',
  '--temp-directory',
  rawCoverage,
  '--all',
  // Instrument only the compiled Node sources the tests above load; without
  // an explicit include, --all also sweeps browser/playwright sources that
  // this node coverage run can never execute.
  '--include',
  '.coverage-dist/apps/**',
  '--include',
  '.coverage-dist/packages/**',
  '--include',
  '.coverage-dist/tests/**',
  '--check-coverage',
  '--lines',
  '85',
  '--statements',
  '85',
  '--functions',
  '85',
  '--branches',
  '85',
  '--reporter',
  'text',
  '--reporter',
  'json-summary',
  '--exclude',
  '**/*.test.js',
  '--exclude',
  '**/test/**',
  '--exclude',
  '**/*.d.ts',
  // Type-only modules compile to coverage-visible wrappers but contain no
  // executable product behavior. Excluding them keeps the global gate honest.
  '--exclude',
  '.coverage-dist/apps/core/src/runtime-types.js',
  '--exclude',
  '.coverage-dist/apps/core/src/admin/routes/types.js',
  '--exclude',
  '.coverage-dist/apps/worker/src/main.js',
  '--exclude',
  '.coverage-dist/apps/worker/src/process-host.js',
  '--exclude',
  '.coverage-dist/packages/admin-contracts/src/api-types.js',
  '--exclude',
  '.coverage-dist/packages/admin-contracts/src/index.js',
  '--exclude',
  '.coverage-dist/packages/mcp-tools/src/service-types.js',
  '--exclude',
  '.coverage-dist/packages/secrets/src/store.js',
]);
