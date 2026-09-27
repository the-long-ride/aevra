import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGenericCommand } from '../src/applications/generic.js';
import { parseGitCommand } from '../src/applications/git.js';
import { parseNodePackageCommand } from '../src/applications/node-packages.js';
import { parseRtkCommand } from '../src/applications/rtk.js';
import { evaluateScriptTrust } from '../src/script-trust.js';
import { tokenizeBash } from '../src/shells/bash.js';
import { tokenizeCmd } from '../src/shells/cmd.js';
import { extractRedirects } from '../src/shells/common.js';
import { detectNestedShell, parseShellScript, parseSingleArgv } from '../src/shells/index.js';
import { tokenizePowerShell } from '../src/shells/powershell.js';

test('detectNestedShell recognises launchers and ignores incomplete invocations', () => {
  assert.equal(detectNestedShell([]), null);
  assert.equal(detectNestedShell(['cmd', '/k', 'dir']), null);
  assert.deepEqual(detectNestedShell(['C:\\Windows\\cmd.exe', '/C', 'dir', 'x']), {
    dialect: 'cmd',
    script: 'dir x',
  });
  assert.deepEqual(detectNestedShell(['pwsh', '-Command', 'Get-Item', '.']), {
    dialect: 'pwsh',
    script: 'Get-Item .',
  });
  assert.equal(detectNestedShell(['powershell.exe', '-c', 'ls'])?.dialect, 'powershell');
  assert.equal(detectNestedShell(['pwsh', '-c']), null);
  assert.equal(detectNestedShell(['zsh', '-lc', 'ls'])?.dialect, 'zsh');
  assert.equal(detectNestedShell(['bash', '-c']), null);
});

test('parseSingleArgv tolerates empty argv', () => {
  const n = parseSingleArgv([], 'direct');
  assert.equal(n.application, '');
  assert.deepEqual(n.operation, ['']);
});

test('parseShellScript enforces depth, node and time budgets', () => {
  const deep = parseShellScript('echo hi', 'bash', 5);
  assert.deepEqual(deep.nodes, []);
  assert.match(deep.reasons[0]!.message, /nested shell depth/);

  const many = parseShellScript('echo a;'.repeat(300), 'bash');
  assert.equal(many.nodes.length, 256);
  assert.ok(many.reasons.some((r) => /maximum node limit/.test(r.message)));

  const expired = parseShellScript('echo a', 'bash', 0, { startedAtMs: -1e12 });
  assert.deepEqual(expired.nodes, []);
  assert.equal(expired.reasons[0]!.code, 'ANALYSIS_LIMIT');

  const afterTokenize = [0, 5000];
  const late = parseShellScript('echo a', 'bash', 0, {
    startedAtMs: 0,
    now: () => afterTokenize.shift() ?? 5000,
  });
  assert.deepEqual(late.nodes, []);
  assert.match(late.reasons.at(-1)!.message, /Parse time exceeds/);

  const ticks = [0, 0, 0, 5000];
  const inLoop = parseShellScript('echo a; echo b; echo c', 'bash', 0, {
    startedAtMs: 0,
    now: () => ticks.shift() ?? 5000,
  });
  assert.equal(inLoop.nodes.length, 1);
  assert.match(inLoop.reasons.at(-1)!.message, /Parse time exceeds/);
});

test('parseShellScript maps input redirects to read targets', () => {
  const res = parseShellScript('sort < in.txt >out.txt', 'bash');
  assert.deepEqual(
    res.nodes[0]!.targets.map((t) => [t.path, t.access]),
    [
      ['in.txt', 'read'],
      ['out.txt', 'write'],
    ],
  );
});

test('extractRedirects handles append descriptors and dangling operators', () => {
  const res = extractRedirects(['cmd', '2>>', 'err.log', '1>>', 'a.log', '>x', '<']);
  assert.deepEqual(res.cleanTokens, ['cmd', '<']);
  assert.deepEqual(res.redirects, [
    { path: 'err.log', kind: 'append' },
    { path: 'a.log', kind: 'append' },
    { path: 'x', kind: 'write' },
  ]);
  // Attached append is currently caught by the attached-write branch first.
  assert.deepEqual(extractRedirects(['>>log']).redirects, [{ path: '>log', kind: 'write' }]);
});

test('PowerShell tokenizer: dynamic evaluation, escapes, quotes and operators', () => {
  const dyn = tokenizePowerShell('iex $payload; pwsh -enc AAAA');
  assert.equal(dyn.reasons.filter((r) => r.code === 'DYNAMIC_SCOPE').length, 2);
  const res = tokenizePowerShell("& 'C:\\Tools\\a b.exe' x`;y \"it's\" || b && c | d\ne");
  assert.deepEqual(res.stages[0]!.argv, ['C:\\Tools\\a b.exe', 'x;y', "it's"]);
  assert.deepEqual(
    res.stages.map((s) => s.edgeToNext),
    ['failure', 'success', 'pipe', 'sequence', undefined],
  );
  assert.deepEqual(tokenizePowerShell('&').stages[0]!.argv, ['&']);
});

test('cmd tokenizer: caret escapes, quotes and operators', () => {
  const res = tokenizeCmd('echo a^&b "c & d" || x & y | z\nw');
  assert.deepEqual(res.stages[0]!.argv, ['echo', 'a&b', 'c & d']);
  assert.deepEqual(
    res.stages.map((s) => s.edgeToNext),
    ['failure', 'sequence', 'pipe', 'sequence', undefined],
  );
});

test('bash tokenizer: backtick substitution, separators and malformed quoting', () => {
  const res = tokenizeBash('echo `ls`; a\nb');
  assert.ok(res.reasons.some((r) => r.message === 'Command substitution detected'));
  assert.deepEqual(
    res.stages.map((s) => s.edgeToNext),
    ['sequence', 'sequence', undefined],
  );
  assert.ok(tokenizeBash("echo 'open").reasons.some((r) => r.code === 'UNSUPPORTED_SYNTAX'));
});

test('generic parser: attached and missing path option values', () => {
  const attached = parseGenericCommand(['grep', '-fpatterns.txt', 'src']);
  assert.deepEqual(attached.options[0], { name: '-f', value: 'patterns.txt', sourceIndex: 1 });
  assert.deepEqual(
    attached.targets.map((t) => [t.path, t.access]),
    [
      ['patterns.txt', 'read'],
      ['src', 'read'],
    ],
  );
  const missing = parseGenericCommand(['grep', '-f']);
  assert.equal(missing.options[0]!.value, undefined);
  assert.ok(missing.reasons.some((r) => /missing its value/.test(r.message)));
});

test('generic parser: explicit copy destination, force flag and bare cd', () => {
  const cp = parseGenericCommand(['cp', '-t', 'dest', 'a', 'b']);
  assert.deepEqual(
    cp.targets.map((t) => [t.path, t.access]),
    [
      ['dest', 'write'],
      ['a', 'read'],
      ['b', 'read'],
    ],
  );
  const rm = parseGenericCommand(['rm', '--force', 'file']);
  assert.deepEqual(rm.modifiers, ['force']);
  assert.equal(rm.risk, 'MEDIUM');
  const cd = parseGenericCommand(['cd']);
  assert.deepEqual(cd.operation, ['cd']);
  assert.deepEqual(cd.targets, []);
  assert.equal(parseGenericCommand([]).application, '');
});

test('rtk mappings: defaults, npm script shorthand and unknown mapping', () => {
  const unknown = parseRtkCommand([]);
  assert.equal(unknown.application, 'rtk');
  assert.equal(unknown.wrappers[0]!.identity.logicalName, 'rtk');
  assert.equal(unknown.reasons[0]!.code, 'UNKNOWN_OPTION');
  const script = parseRtkCommand(['rtk', 'npm', 'build']);
  assert.equal(script.scriptName, 'build');
  assert.equal(script.wrappers[0]!.app, 'rtk');
  const bare = parseRtkCommand(['rtk', 'npm']);
  assert.equal(bare.application, 'npm');
  assert.equal(bare.scriptName, undefined);
  assert.deepEqual(parseRtkCommand(['rtk', 'cargo']).operation, ['build']);
  assert.deepEqual(parseRtkCommand(['rtk', 'dotnet']).operation, ['build']);
  assert.equal(parseRtkCommand(['rtk', 'dotnet', 'format']).effect, 'SOURCE_MUTATION');
  assert.equal(parseRtkCommand(['rtk', 'cargo', 'fmt']).effect, 'SOURCE_MUTATION');
});

test('node package and git parsers: forwarded args, global flag, pre-subcommand options', () => {
  const fwd = parseNodePackageCommand('npm', ['npm', 'run', 'build', '--', '--watch']);
  assert.deepEqual(fwd.forwardedArgv, ['--watch']);
  const global = parseNodePackageCommand('npm', ['npm', 'install', '-g', 'x']);
  assert.ok(global.modifiers.includes('global'));
  const git = parseGitCommand(['git', '--no-pager', 'log']);
  assert.ok(git.options.some((o) => o.name === '--no-pager'));
});

test('script trust evaluation covers missing, invalid and lifecycle-aware fingerprints', () => {
  assert.equal(evaluateScriptTrust('build', null).reason, 'PACKAGE_JSON_MISSING');
  assert.equal(evaluateScriptTrust('build', '{bad').reason, 'PACKAGE_JSON_INVALID');
  assert.equal(evaluateScriptTrust('build', '{}').reason, 'SCRIPT_NOT_FOUND');
  const plain = evaluateScriptTrust('build', JSON.stringify({ scripts: { build: 'tsc' } }));
  const withHooks = evaluateScriptTrust(
    'build',
    JSON.stringify({
      type: 'module',
      packageManager: 'npm@10',
      scripts: { build: 'tsc', prebuild: 'clean', postbuild: 'copy' },
    }),
  );
  assert.equal(plain.status, 'unapproved');
  assert.notEqual(plain.fingerprint, withHooks.fingerprint);
  const text = JSON.stringify({ scripts: { build: 'tsc' } });
  assert.equal(evaluateScriptTrust('build', text, plain.fingerprint).status, 'trusted');
  const changed = evaluateScriptTrust('build', text, 'older');
  assert.equal(changed.status, 'changed');
  assert.equal(changed.previousFingerprint, 'older');
});
