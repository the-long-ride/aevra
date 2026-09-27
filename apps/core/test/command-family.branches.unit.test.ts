import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCommand } from '../src/policy/command-family.js';
import { commandPermissionMatcher, needsCommandPermissionApproval } from '../src/policy/command-matcher.js';

const shape = (command: string | string[]) => {
  const { family, effect, outputKeys } = classifyCommand(command);
  return `${family}|${effect}|${outputKeys.join(',')}`;
};

test('classifyCommand tokenizes strings with quotes and handles empty input', () => {
  assert.equal(shape('git "status"'), 'git:status|READ_ONLY|');
  assert.equal(shape("C:\\tools\\GIT 'log'"), 'git:log|READ_ONLY|');
  assert.equal(shape(''), ':run|UNKNOWN|');
  assert.equal(shape([]), ':run|UNKNOWN|');
  assert.equal(shape(['/usr/bin/ls']), 'ls:run|READ_ONLY|');
});

test('classifyCommand maps git, package managers, cargo, dotnet, and readers', () => {
  assert.equal(shape(['git', 'reset']), 'git:reset|REPOSITORY_STATE|');
  assert.equal(shape(['git', 'commit']), 'git:commit|SOURCE_MUTATION|');
  assert.equal(shape(['pnpm', 'lint']), 'pnpm:lint|BUILD_OUTPUT|node_modules/.cache,coverage');
  assert.equal(shape(['yarn', 'add']), 'package:install|BUILD_OUTPUT|node_modules,package-lock.json,pnpm-lock.yaml,yarn.lock');
  assert.equal(shape(['npm', 'run']), 'npm:run|UNKNOWN|');
  assert.equal(shape(['cargo', 'check']), 'cargo:check|BUILD_OUTPUT|target');
  assert.equal(shape(['cargo', 'fmt']), 'cargo:fmt|SOURCE_MUTATION|');
  assert.equal(shape(['cargo', 'run']), 'cargo:run|UNKNOWN|');
  assert.equal(shape(['dotnet', 'restore']), 'dotnet:restore|BUILD_OUTPUT|bin,obj');
  assert.equal(shape(['dotnet', 'format']), 'dotnet:format|SOURCE_MUTATION|');
  assert.equal(shape(['dotnet', 'run']), 'dotnet:run|UNKNOWN|');
  assert.equal(shape(['rg', 'word']), 'rg:word|READ_ONLY|');
  assert.equal(shape(['python', 'x.py']), 'python:x.py|UNKNOWN|');
});

test('shell wrappers are HIGH unless the script is critical', () => {
  assert.deepEqual(classifyCommand(['bash', '-c', 'echo hi']), { family: 'shell:bash', effect: 'UNKNOWN', risk: 'HIGH', outputKeys: [] });
  assert.equal(classifyCommand(['pwsh.exe', '-Command', 'Get-Date']).family, 'shell:powershell');
  assert.equal(classifyCommand(['powershell', '-NoLogo']).family, 'shell:powershell');
  assert.equal(classifyCommand(['sh', '-lc', 'dd if=/dev/zero of=/dev/sda']).risk, 'CRITICAL');
  assert.equal(classifyCommand(['bash', 'script.sh']).family, 'bash:script.sh');
});

test('commandPermissionMatcher normalizes shells, subcommands, options, and separators', () => {
  assert.equal(commandPermissionMatcher(['bash', '-c', 'x']), 'shell:bash:*');
  assert.equal(commandPermissionMatcher(['C:\\bin\\pwsh.exe', '-c', 'x'], { executionMode: 'host' }), 'shell:powershell:*:host-fallback');
  assert.equal(commandPermissionMatcher(['node', 'x'], { shell: 'CMD' }), 'shell:cmd:*');
  assert.equal(commandPermissionMatcher({ executable: 'Git.EXE', args: ['Commit', '-m', 'msg', 'more'] }), 'git:commit:-m:*');
  assert.equal(commandPermissionMatcher({ executable: 'npm', args: ['--version'] }), 'npm:--version');
  assert.equal(commandPermissionMatcher({ executable: 'node', args: undefined as any }), 'node');
  assert.equal(commandPermissionMatcher(['npx', 'tsc', '--out=dist', '--', 'a', 'b']), 'npx:tsc:--out:*:--:*');
  assert.equal(commandPermissionMatcher(['tool', '-=x', 'a']), 'tool:-:*');
  assert.equal(commandPermissionMatcher(['']), 'unknown');
  assert.equal(commandPermissionMatcher([]), 'unknown');
});

test('needsCommandPermissionApproval skips one-time allowances and allow outcomes', () => {
  assert.equal(needsCommandPermissionApproval('allow', false), false);
  assert.equal(needsCommandPermissionApproval('deny', true), false);
  assert.equal(needsCommandPermissionApproval('approval', false), true);
  assert.equal(needsCommandPermissionApproval(undefined, false), true);
});
