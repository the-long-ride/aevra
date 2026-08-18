import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const output = path.join(root, '.coverage-dist');

function command(program, args) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
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
command('tsc', ['-p', 'tsconfig.coverage.json']);

const tests = [
  ...testFiles(path.join(output, 'apps')),
  ...testFiles(path.join(output, 'packages')),
  ...testFiles(path.join(output, 'tests')),
];

if (tests.length === 0) {
  console.error('No compiled Node tests found for coverage.');
  process.exit(1);
}

command('c8', [
  '--all',
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
  process.execPath,
  '--test',
  ...tests,
]);
