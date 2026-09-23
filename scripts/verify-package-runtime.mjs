import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = [
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  process.env.npm_execpath,
].find((candidate) => candidate && existsSync(candidate));
assert.ok(npmCli, 'Cannot locate npm-cli.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'aevra-package-'));

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

function compiledJavaScript(root) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (file.endsWith('.js')) files.push(file);
    }
  }
  visit(root);
  return files;
}

function missingRelativeImports(packageRoot) {
  const missing = new Set();
  for (const file of compiledJavaScript(join(packageRoot, 'dist'))) {
    const source = readFileSync(file, 'utf8');
    const imports = /\b(?:from\s*|import\s*\(\s*|import\s*)(['"])(\.[^'"\n]+)\1/g;
    for (const match of source.matchAll(imports)) {
      const target = resolve(dirname(file), match[2]);
      if (!existsSync(target)) missing.add(relative(packageRoot, target));
    }
  }
  return [...missing].sort();
}

try {
  const packed = JSON.parse(
    run(process.execPath, [
      npmCli,
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      tempRoot,
    ]),
  )[0];
  const installRoot = join(tempRoot, 'install');
  run(process.execPath, [
    npmCli,
    'install',
    '--prefix',
    installRoot,
    join(tempRoot, packed.filename),
    '--ignore-scripts',
    '--offline',
    '--no-audit',
    '--no-fund',
  ]);

  const packageRoot = join(installRoot, 'node_modules', '@the-long-ride', 'aevra');
  const missingImports = missingRelativeImports(packageRoot);
  assert.deepEqual(missingImports, [], `Missing packaged imports:\n${missingImports.join('\n')}`);

  const installedManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const cli = spawnSync(
    process.execPath,
    [join(packageRoot, installedManifest.bin.aevra), '--version'],
    {
      cwd: installRoot,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    },
  );
  assert.ifError(cli.error);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), installedManifest.version);
  console.log(
    `Verified packed aevra ${installedManifest.version}: no missing imports; CLI starts.`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
