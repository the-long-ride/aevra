import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const output = path.join(root, '.coverage-dist');

// Resolve the local tool entries so every child spawns as
// `node <entry>` without a shell. On Windows a shelled command line holding
// hundreds of compiled test paths exceeds cmd.exe's length limit.
const toolEntries = {
  tsc: path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  c8: path.join(root, 'node_modules', 'c8', 'bin', 'c8.js'),
};

function command(program, args) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false,
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

command(process.execPath, [
  toolEntries.c8,
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
  '75',
  '--statements',
  '75',
  '--functions',
  '75',
  '--branches',
  '75',
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
  process.execPath,
  '--test',
  ...tests,
]);
