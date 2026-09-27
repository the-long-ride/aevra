import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeCommand } from '../src/analyze.js';
import { propagateCwdFlow } from '../src/cwd-flow.js';
import { evaluateScope } from '../src/scope.js';
import type { AnalysisContext, CommandNode } from '../src/types.js';

function ctx(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  return {
    actor: 'test',
    sessionId: 's1',
    workspaceId: 'w1',
    rootsRevision: '1',
    platform: 'linux',
    backendId: 'host',
    backendRevision: '1',
    policyRevision: '1',
    environmentFingerprint: 'env',
    resolverGeneration: '1',
    ...overrides,
  };
}

function node(id: string, overrides: Partial<CommandNode> = {}): CommandNode {
  return {
    id,
    dialect: 'bash',
    argv: ['echo'],
    wrappers: [],
    application: 'echo',
    operation: ['echo'],
    options: [],
    forwardedArgv: [],
    cwdCandidates: [],
    modifiers: [],
    targets: [],
    effect: 'READ_ONLY',
    risk: 'LOW',
    scope: 'inside',
    reasons: [],
    ...overrides,
  };
}

const identity = (name: string) => ({
  logicalName: name,
  canonicalPath: `/usr/bin/${name}`,
  launcher: 'native' as const,
  fingerprint: `fp_${name}`,
  provenance: 'installed' as const,
  backendId: 'host',
});

const PKG = JSON.stringify({ scripts: { build: 'tsc -p .' } });

function configServices(seen: string[], extra: Record<string, unknown> = {}) {
  return {
    resolveExecutable: async () => null,
    canonicalize: async (p: string, cwd: string) => ({
      canonicalPath: p.startsWith('/') ? p : `${cwd}/${p}`.replace('//', '/'),
      scope: 'inside' as const,
      reasons: [],
    }),
    readConfig: async (p: string) => {
      seen.push(p.replaceAll('\\', '/'));
      return { text: PKG, fingerprint: 'pkg' };
    },
    ...extra,
  };
}

const ROOTED = ctx({ roots: [{ logicalPrefix: '/repo', hostRoot: '/repo' }] });

test('package cwd operands -C and --dir select the package.json location', async () => {
  for (const argv of [
    ['npm', '-C', 'pkg-a', 'run', 'build'],
    ['pnpm', '--dir', 'pkg-b', 'run', 'build'],
  ]) {
    const seen: string[] = [];
    const res = await analyzeCommand(
      { kind: 'argv', argv, cwdLogical: '/repo', executionMode: 'host' },
      ROOTED,
      configServices(seen),
    );
    assert.deepEqual(seen, [`/repo/${argv[2]}/package.json`]);
    assert.ok(res.nodes[0]!.scriptFingerprint, `fingerprint for ${argv[0]}`);
  }
});

test('canonicalizeCwd is preferred for package lookup and cwd scope', async () => {
  const seen: string[] = [];
  const cwdCalls: string[] = [];
  const services = configServices(seen, {
    canonicalizeCwd: async (cwd: string) => {
      cwdCalls.push(cwd);
      return { canonicalPath: '/canonical/repo', scope: 'inside' as const, reasons: [] };
    },
  });
  const res = await analyzeCommand(
    { kind: 'argv', argv: ['npm', 'run', 'build'], cwdLogical: '/repo', executionMode: 'host' },
    ROOTED,
    services,
  );
  assert.deepEqual(seen, ['/canonical/repo/package.json']);
  assert.ok(cwdCalls.length >= 2);
  assert.deepEqual(res.nodes[0]!.canonicalCwdCandidates, ['/canonical/repo']);
});

test('package lookup is skipped outside the workspace and read errors are ignored', async () => {
  const seen: string[] = [];
  const outside = await analyzeCommand(
    { kind: 'argv', argv: ['npm', 'run', 'build'], cwdLogical: '/repo', executionMode: 'host' },
    ROOTED,
    configServices(seen, {
      canonicalizeCwd: async () => ({ scope: 'outside' as const, reasons: [] }),
    }),
  );
  assert.deepEqual(seen, []);
  assert.equal(outside.scope, 'outside');

  const failing = await analyzeCommand(
    { kind: 'argv', argv: ['npm', 'run', 'build'], cwdLogical: '/repo', executionMode: 'host' },
    ROOTED,
    configServices([], {
      readConfig: async () => {
        throw new Error('unreadable');
      },
    }),
  );
  assert.equal(failing.nodes[0]!.scriptFingerprint, undefined);
  assert.equal(failing.nodes[0]!.scriptName, 'build');
});

test('script requests: missing body, platform default dialect and explicit shell', async () => {
  const empty = await analyzeCommand({ kind: 'script', executionMode: 'host' }, ctx());
  assert.deepEqual(empty.nodes, []);
  assert.equal(empty.parseStatus, 'complete');

  const win = await analyzeCommand(
    { kind: 'script', script: 'Get-ChildItem', shell: 'auto', executionMode: 'host' },
    ctx({ platform: 'win32' }),
  );
  assert.equal(win.nodes[0]!.dialect, 'powershell');
  const cmd = await analyzeCommand(
    { kind: 'script', script: 'dir', shell: 'cmd', executionMode: 'host' },
    ctx({ platform: 'linux' }),
  );
  assert.equal(cmd.nodes[0]!.dialect, 'cmd');
});

test('argv requests fall back to the executable field', async () => {
  const res = await analyzeCommand({ kind: 'argv', executable: 'git', executionMode: 'host' }, ctx());
  assert.equal(res.nodes.length, 1);
  assert.equal(res.nodes[0]!.application, 'git');
  const none = await analyzeCommand({ kind: 'argv', executionMode: 'host' }, ctx());
  assert.equal(none.parseStatus, 'invalid');
});

test('node budgets truncate script and nested argv expansions', async () => {
  const script = 'echo a; '.repeat(255) + 'bash -c "echo 1; echo 2; echo 3"';
  const res = await analyzeCommand({ kind: 'script', script, shell: 'bash', executionMode: 'host' }, ctx());
  assert.equal(res.nodes.length, 256);
  assert.equal(res.parseStatus, 'unsupported');
  assert.ok(res.reasons.some((r) => r.message.includes('256 node parse budget')));

  const nested = await analyzeCommand(
    { kind: 'argv', argv: ['bash', '-c', 'echo a; '.repeat(300)], executionMode: 'host' },
    ctx(),
  );
  assert.equal(nested.nodes.length, 256);
  assert.ok(nested.reasons.some((r) => r.message === 'Node count exceeds 256 budget'));
});

test('custom parse status is never upgraded by weaker reasons', async () => {
  const parse = (status: 'partial' | 'invalid', code: string) => async () => ({
    status,
    nodes: [node('n1', { reasons: [{ code, message: 'x' }] })],
    edges: [],
    reasons: [],
  });
  const base = { resolveExecutable: async () => null, canonicalize: async () => ({ scope: 'inside' as const, reasons: [] }), readConfig: async () => null };
  const partial = await analyzeCommand(
    { kind: 'argv', argv: ['echo'], executionMode: 'host' },
    ctx(),
    { ...base, parse: parse('partial', 'UNSUPPORTED_SYNTAX') },
  );
  assert.equal(partial.parseStatus, 'partial');
  assert.equal(partial.scope, 'unknown');
  const invalid = await analyzeCommand(
    { kind: 'argv', argv: ['echo'], executionMode: 'host' },
    ctx(),
    { ...base, parse: async () => ({ status: 'invalid' as const, nodes: [node('n2')], edges: [], reasons: [{ code: 'UNKNOWN_OPTION', message: 'y' }] }) },
  );
  assert.equal(invalid.parseStatus, 'invalid');
});

test('roots default from workspaceRoot or to an unbound root', async () => {
  const withRoot = await analyzeCommand(
    { kind: 'argv', argv: ['ls', '/elsewhere'], executionMode: 'host' },
    ctx({ workspaceRoot: '/repo' }),
  );
  assert.equal(withRoot.scope, 'inside');
  const unbound = await analyzeCommand({ kind: 'argv', argv: ['ls'], executionMode: 'host' }, ctx());
  assert.equal(unbound.scope, 'inside');
});

test('executable resolution covers application fallback and wrapper identities', async () => {
  const asked: string[] = [];
  const services = {
    parse: async () => ({
      status: 'complete' as const,
      nodes: [
        node('n1', {
          argv: [],
          application: 'tool',
          wrappers: [
            { app: 'rtk', identity: { ...identity('rtk'), logicalName: '' }, mappingVersion: '1' },
            { app: 'shim', identity: identity('shim'), mappingVersion: '1' },
          ],
        }),
      ],
      edges: [],
      reasons: [],
    }),
    resolveExecutable: async (name: string) => {
      asked.push(name);
      return name === 'shim' ? null : identity(name);
    },
    canonicalize: async () => ({ scope: 'inside' as const, reasons: [] }),
    readConfig: async () => null,
  };
  const res = await analyzeCommand({ kind: 'argv', argv: ['tool'], executionMode: 'host' }, ctx(), services);
  assert.deepEqual(asked, ['tool', 'rtk', 'shim']);
  assert.equal(res.nodes[0]!.executable?.fingerprint, 'fp_tool');
  assert.equal(res.nodes[0]!.wrappers[0]!.identity.fingerprint, 'fp_rtk');
  assert.equal(res.nodes[0]!.wrappers[1]!.identity.fingerprint, 'fp_shim');
});

test('evaluateScope: case folding, trailing-slash prefixes and host-root containment', async () => {
  const roots = [{ logicalPrefix: '/repo', hostRoot: '/other' }];
  const upper = [node('a', { cwdCandidates: ['/REPO/sub'] })];
  assert.equal((await evaluateScope(upper, roots, undefined, ctx({ platform: 'win32' }))).scope, 'inside');
  const upper2 = [node('b', { cwdCandidates: ['/REPO/sub'] })];
  assert.equal((await evaluateScope(upper2, roots, undefined, ctx())).scope, 'outside');
  const host = [node('c', { cwdCandidates: ['/OTHER/x'] })];
  assert.equal((await evaluateScope(host, roots, undefined, ctx({ platform: 'win32' }))).scope, 'inside');
  const slash = [node('d', { cwdCandidates: ['/repo/a'], targets: [{ path: 'b.txt', access: 'read', scope: 'unknown' }] })];
  const res = await evaluateScope(slash, [{ logicalPrefix: '/repo/' }], undefined, ctx());
  assert.equal(res.scope, 'inside');
  assert.equal(slash[0]!.targets[0]!.scope, 'inside');
  const rootless = [node('e', { targets: [{ path: 'rel.txt', access: 'read', scope: 'unknown' }] })];
  await evaluateScope(rootless, [{ logicalPrefix: '/' }], undefined, ctx());
  assert.equal(rootless[0]!.targets[0]!.scope, 'inside');
});

test('evaluateScope: outside wins over later unknown or dynamic evidence', async () => {
  const verdicts: Record<string, 'outside' | 'unknown' | 'inside'> = { '/out': 'outside', '/unk': 'unknown', 'o.txt': 'outside', 'u.txt': 'unknown' };
  const cwds: string[] = [];
  const services = {
    canonicalizeTarget: async (p: string, cwd: string) => {
      cwds.push(cwd);
      return { scope: verdicts[p] ?? ('inside' as const), reasons: [{ code: 'X', message: p }] };
    },
  } as any;
  const n = node('n', { cwdCandidates: ['/out', '/unk'] });
  assert.equal((await evaluateScope([n], [{ logicalPrefix: '/' }], services, ctx())).scope, 'outside');
  assert.equal(n.scope, 'outside');
  const t = node('t', {
    targets: [
      { path: 'o.txt', access: 'read', scope: 'unknown' },
      { path: 'u.txt', access: 'read', scope: 'unknown' },
      { path: '$HOME/x', access: 'write', scope: 'unknown' },
    ],
  });
  const res = await evaluateScope([t], [{ logicalPrefix: '/' }], services, ctx());
  assert.equal(res.scope, 'outside');
  assert.equal(t.targets[1]!.scope, 'unknown');
  assert.equal(t.targets[2]!.scope, 'unknown');
  assert.ok(cwds.includes('/'));
});

test('propagateCwdFlow: drive-letter and relative roots, pushd/popd, pipe and subshell', () => {
  const drive = [node('c1', { application: 'builtin:cd', operation: ['cd', 'sub'] }), node('e1')];
  propagateCwdFlow('C:\\work', drive, []);
  assert.deepEqual(drive[0]!.cwdCandidates, ['C:/work/sub']);
  assert.deepEqual(drive[1]!.cwdCandidates, ['C:/work/sub']);

  const rel = [node('r1')];
  propagateCwdFlow('repo', rel, []);
  assert.deepEqual(rel[0]!.cwdCandidates, ['/repo']);

  const stack = [
    node('p1', { application: 'builtin:pushd', operation: ['pushd', 'a'] }),
    node('p2'),
    node('p3', { application: 'builtin:popd', operation: ['popd'] }),
    node('p4', { application: 'builtin:popd', operation: ['popd'] }),
  ];
  propagateCwdFlow('/', stack, []);
  assert.deepEqual(stack[1]!.cwdCandidates, ['/a']);
  assert.deepEqual(stack[2]!.cwdCandidates, ['/']);
  assert.deepEqual(stack[3]!.cwdCandidates, ['/']);

  for (const kind of ['pipe', 'subshell'] as const) {
    const piped = [node('x1', { application: 'builtin:cd', operation: ['cd', 'inner'] }), node('x2')];
    propagateCwdFlow('/', piped, [{ from: 'x1', to: 'x2', kind }]);
    assert.deepEqual(piped[1]!.cwdCandidates, ['/'], kind);
  }
});
