import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGenericCommand } from '../src/applications/generic.js';
import { parseGitCommand } from '../src/applications/git.js';
import { parseNodePackageCommand } from '../src/applications/node-packages.js';
import { parseRtkCommand } from '../src/applications/rtk.js';
import { evaluateScriptTrust } from '../src/script-trust.js';
import { tokenizeBash } from '../src/shells/bash.js';
import { tokenizeCmd } from '../src/shells/cmd.js';
import { tokenizePowerShell } from '../src/shells/powershell.js';

test('git: command parser branch coverage', () => {
  // -C flag, --git-dir, --work-tree
  const nodeC = parseGitCommand(['git', '-C', '/custom/path', 'status']);
  assert.equal(nodeC.cwdCandidates[0], '/custom/path');
  assert.equal(nodeC.effect, 'READ_ONLY');

  const nodeGitDir = parseGitCommand(['git', '--git-dir=/repo/.git', 'diff']);
  assert.equal(nodeGitDir.options[0]?.name, '--git-dir');
  assert.equal(nodeGitDir.effect, 'READ_ONLY');

  const nodeGitDirSplit = parseGitCommand(['git', '--git-dir', '/repo/.git', 'log']);
  assert.equal(nodeGitDirSplit.options[0]?.name, '--git-dir');

  const nodeWorkTree = parseGitCommand(['git', '--work-tree=/repo', 'checkout', 'main']);
  assert.equal(nodeWorkTree.effect, 'REPOSITORY_STATE');

  const nodeWorkTreeSplit = parseGitCommand(['git', '--work-tree', '/repo', 'pull']);
  assert.equal(nodeWorkTreeSplit.effect, 'REPOSITORY_STATE');

  // Forwarded args after --
  const nodeFwd = parseGitCommand(['git', 'checkout', '--', 'file.txt']);
  assert.deepEqual(nodeFwd.forwardedArgv, ['file.txt']);

  // Branch subcommands and modifiers
  const branchDelete = parseGitCommand(['git', 'branch', '-D', 'feature']);
  assert.ok(branchDelete.modifiers.includes('delete-branch'));
  assert.equal(branchDelete.risk, 'HIGH');

  const branchList = parseGitCommand(['git', 'branch']);
  assert.equal(branchList.effect, 'READ_ONLY');

  // Push, reset, clean, commit, add, tag
  const pushForce = parseGitCommand(['git', 'push', '--force-with-lease']);
  assert.equal(pushForce.risk, 'HIGH');

  const pushNormal = parseGitCommand(['git', 'push', 'origin', 'main']);
  assert.equal(pushNormal.risk, 'MEDIUM');

  const resetHard = parseGitCommand(['git', 'reset', '--hard', 'HEAD~1']);
  assert.equal(resetHard.risk, 'HIGH');

  const resetSoft = parseGitCommand(['git', 'reset', 'HEAD~1']);
  assert.equal(resetSoft.risk, 'MEDIUM');

  const clean = parseGitCommand(['git', 'clean', '-fd']);
  assert.equal(clean.risk, 'HIGH');

  const commit = parseGitCommand(['git', 'commit', '-m', 'feat']);
  assert.equal(commit.effect, 'SOURCE_MUTATION');

  const add = parseGitCommand(['git', 'add', '.']);
  assert.equal(add.effect, 'SOURCE_MUTATION');

  const tag = parseGitCommand(['git', 'tag', 'v1.0']);
  assert.equal(tag.effect, 'SOURCE_MUTATION');

  const emptyGit = parseGitCommand(['git']);
  assert.equal(emptyGit.effect, 'READ_ONLY');
});

test('generic: command parser cd and filesystem utils', () => {
  // cd variations: -d, -Path, --, absolute, relative
  const cdWin = parseGenericCommand(['cd', '/d', 'D:\\work'], 'cmd');
  assert.equal(cdWin.cwdCandidates[0], 'D:\\work');

  const cdPwsh = parseGenericCommand(['cd', '-Path', 'C:\\work'], 'pwsh');
  assert.equal(cdPwsh.cwdCandidates[0], 'C:\\work');

  const cdDashes = parseGenericCommand(['cd', '--', '/home/user'], 'bash');
  assert.equal(cdDashes.cwdCandidates[0], '/home/user');

  const cdSimple = parseGenericCommand(['cd', 'sub/dir'], 'direct');
  assert.equal(cdSimple.cwdCandidates[0], 'sub/dir');

  // Mutation tools: rm -rf, del /s, mkdir, cp, mv
  const rmRf = parseGenericCommand(['rm', '-rf', 'dist'], 'bash');
  assert.equal(rmRf.risk, 'HIGH');

  const delS = parseGenericCommand(['del', '/s', 'build'], 'cmd');
  assert.equal(delS.effect, 'SOURCE_MUTATION');

  const mkdir = parseGenericCommand(['mkdir', 'newdir']);
  assert.equal(mkdir.effect, 'SOURCE_MUTATION');

  const cp = parseGenericCommand(['cp', 'a.txt', 'b.txt']);
  assert.equal(cp.effect, 'SOURCE_MUTATION');

  // Read only tools
  const cat = parseGenericCommand(['cat', 'file.txt']);
  assert.equal(cat.effect, 'READ_ONLY');

  const type = parseGenericCommand(['type', 'file.txt'], 'cmd');
  assert.equal(type.effect, 'READ_ONLY');
});

test('generic: filesystem operands become scoped read/write targets', () => {
  assert.deepEqual(parseGenericCommand(['cat', '../../outside.txt']).targets, [
    { path: '../../outside.txt', access: 'read', scope: 'unknown' },
  ]);
  assert.deepEqual(parseGenericCommand(['type', 'C:\\outside.txt'], 'cmd').targets, [
    { path: 'C:\\outside.txt', access: 'read', scope: 'unknown' },
  ]);
  assert.deepEqual(parseGenericCommand(['rm', '-rf', '--', '../outside']).targets, [
    { path: '../outside', access: 'write', scope: 'unknown' },
  ]);
  assert.deepEqual(parseGenericCommand(['cp', '--', 'a.txt', '../outside.txt']).targets, [
    { path: 'a.txt', access: 'read', scope: 'unknown' },
    { path: '../outside.txt', access: 'write', scope: 'unknown' },
  ]);
  assert.deepEqual(parseGenericCommand(['mv', 'a.txt', 'b.txt']).targets, [
    { path: 'a.txt', access: 'read', scope: 'unknown' },
    { path: 'b.txt', access: 'write', scope: 'unknown' },
  ]);
});

test('generic: grep, ripgrep, and find operands participate in read scope', () => {
  assert.deepEqual(parseGenericCommand(['grep', 'needle', '../outside.txt']).targets, [
    { path: 'needle', access: 'read', scope: 'unknown' },
    { path: '../outside.txt', access: 'read', scope: 'unknown' },
  ]);
  assert.deepEqual(parseGenericCommand(['rg', '--glob', '*.ts', 'needle', '../outside']).targets, [
    { path: '*.ts', access: 'read', scope: 'unknown' },
    { path: 'needle', access: 'read', scope: 'unknown' },
    { path: '../outside', access: 'read', scope: 'unknown' },
  ]);
  assert.deepEqual(parseGenericCommand(['find', '../outside', '-name', '*.txt']).targets, [
    { path: '../outside', access: 'read', scope: 'unknown' },
    { path: '*.txt', access: 'read', scope: 'unknown' },
  ]);
});

test('generic: path-bearing options participate in containment targets', () => {
  const cp = parseGenericCommand(['cp', '--target-directory=/outside', 'source.txt']);
  assert.deepEqual(cp.targets, [
    { path: '/outside', access: 'write', scope: 'unknown' },
    { path: 'source.txt', access: 'read', scope: 'unknown' },
  ]);

  const rg = parseGenericCommand(['rg', '--file=/outside/patterns.txt', 'src']);
  assert.ok(
    rg.targets.some(
      (target) => target.path === '/outside/patterns.txt' && target.access === 'read',
    ),
  );

  const unknown = parseGenericCommand(['cp', '--mystery=/outside', 'a', 'b']);
  assert.ok(unknown.reasons.some((reason) => reason.code === 'UNKNOWN_OPTION'));
});

test('generic: mutating find expressions are not classified read-only', () => {
  const deletion = parseGenericCommand(['find', '.', '-delete']);
  assert.notEqual(deletion.effect, 'READ_ONLY');
  assert.ok(['MEDIUM', 'HIGH'].includes(deletion.risk));
});

test('node-packages: parser prefixes, run, audit, install, and publish', () => {
  const npmPfx = parseNodePackageCommand('npm', ['npm', '--prefix', 'app', 'run', 'build']);
  assert.equal(npmPfx.scriptName, 'build');
  assert.equal(npmPfx.cwdCandidates.length, 0);
  assert.deepEqual(npmPfx.targets[0], { path: 'app', access: 'cwd', scope: 'unknown' });

  const npmPfxEq = parseNodePackageCommand('npm', ['npm', '--prefix=app', 'test']);
  assert.equal(npmPfxEq.effect, 'BUILD_OUTPUT');

  const pnpmDir = parseNodePackageCommand('pnpm', ['pnpm', '--dir', 'pkg', 'install']);
  assert.equal(pnpmDir.effect, 'BUILD_OUTPUT');

  const yarnC = parseNodePackageCommand('yarn', ['yarn', '-C', 'pkg', 'audit', '--fix']);
  assert.equal(yarnC.effect, 'SOURCE_MUTATION');

  const yarnAuditRead = parseNodePackageCommand('yarn', ['yarn', 'audit']);
  assert.equal(yarnAuditRead.effect, 'READ_ONLY');

  const npmGlobal = parseNodePackageCommand('npm', ['npm', 'install', '-g', 'typescript']);
  assert.equal(npmGlobal.risk, 'HIGH');

  const bunPublish = parseNodePackageCommand('bun', ['bun', 'publish']);
  assert.equal(bunPublish.risk, 'HIGH');

  const npxExec = parseNodePackageCommand('npm', ['npm', 'exec', 'rimraf']);
  assert.equal(npxExec.risk, 'HIGH');

  const npmHelp = parseNodePackageCommand('npm', ['npm']);
  assert.equal(npmHelp.effect, 'READ_ONLY');
});

test('rtk: command parser handles supported tool wrappers', () => {
  const pnpm = parseRtkCommand(['rtk', 'pnpm', 'test']);
  assert.equal(pnpm.application, 'pnpm');

  const tsc = parseRtkCommand(['rtk', 'tsc']);
  assert.equal(tsc.application, 'tsc');

  const lint = parseRtkCommand(['rtk', 'lint']);
  assert.equal(lint.application, 'eslint');

  const prettier = parseRtkCommand(['rtk', 'prettier', '--check', '.']);
  assert.equal(prettier.application, 'prettier');
  assert.equal(prettier.effect, 'READ_ONLY');

  const prettierWrite = parseRtkCommand(['rtk', 'prettier', '--write', '.']);
  assert.equal(prettierWrite.effect, 'SOURCE_MUTATION');

  const cargo = parseRtkCommand(['rtk', 'cargo', 'test']);
  assert.equal(cargo.application, 'cargo');

  const cargoFmt = parseRtkCommand(['rtk', 'cargo', 'fmt']);
  assert.equal(cargoFmt.effect, 'SOURCE_MUTATION');

  const pip = parseRtkCommand(['rtk', 'pip', 'install', 'pytest']);
  assert.equal(pip.application, 'pip');

  const pytest = parseRtkCommand(['rtk', 'pytest']);
  assert.equal(pytest.application, 'pytest');

  const jest = parseRtkCommand(['rtk', 'jest']);
  assert.equal(jest.application, 'jest');

  const dotnet = parseRtkCommand(['rtk', 'dotnet', 'build']);
  assert.equal(dotnet.application, 'dotnet');

  const dotnetFmt = parseRtkCommand(['rtk', 'dotnet', 'format']);
  assert.equal(dotnetFmt.effect, 'SOURCE_MUTATION');

  const curl = parseRtkCommand(['rtk', 'curl', 'https://example.com']);
  assert.equal(curl.application, 'rtk');
  assert.equal(curl.risk, 'HIGH');
});

test('script-trust: handles invalid json and missing scripts', () => {
  assert.equal(evaluateScriptTrust('test', '{ invalid: json').status, 'unapproved');
  assert.equal(evaluateScriptTrust('missing', '{"scripts":{}}').status, 'unapproved');
  assert.equal(evaluateScriptTrust('build', '{"scripts":{"build":"echo 1"}}').status, 'unapproved');
});

test('shells: tokenizer branch coverage for bash, cmd, and pwsh', () => {
  // Bash quotes, escapes, redirects, evals, command substitutions
  const bash = tokenizeBash(
    'echo "hello world" && cat < input.txt | grep \\$test || eval "exit 1"',
  );
  assert.ok(bash.stages.length >= 3);
  assert.ok(bash.reasons.some((r) => r.code === 'DYNAMIC_SCOPE'));

  // Cmd redirects, delimiters, escapes
  const cmd = tokenizeCmd('dir & echo 1 && type file.txt > out.txt | findstr /i test');
  assert.ok(cmd.stages.length >= 3);

  // PowerShell redirects, pipes, semicolons
  const pwsh = tokenizePowerShell('Get-Process; Write-Host "done" | Out-File -FilePath log.txt');
  assert.ok(pwsh.stages.length >= 2);
});
