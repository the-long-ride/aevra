import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createAnalysisServices,
  evaluateAndDecideCommand,
} from '../src/command-decision-bridge.js';

const mockCtx: any = {
  actor: 'operator',
  sessionId: 's1',
  workspaceId: 'w1',
  platform: 'linux',
  backendId: 'host',
};

test('createAnalysisServices: empty roots returns unknown scope', async () => {
  const services = createAnalysisServices();
  const res = await services.canonicalize('/some/path', '/', 'read', mockCtx);
  assert.equal(res.scope, 'unknown');
  assert.equal(res.canonicalPath, '/some/path');
});

test('createAnalysisServices: roots without commands.run returns outside scope', async () => {
  const services = createAnalysisServices('/work', [
    {
      kind: 'workspace',
      id: 'r1',
      logicalPrefix: '/read',
      hostRoot: '/work/read',
      capabilities: ['files.read'],
    },
  ]);
  const res = await services.canonicalize('/read/foo.txt', '/read', 'read', mockCtx);
  assert.equal(res.scope, 'outside');
  assert.equal(res.reasons[0]?.code, 'OUTSIDE_WORKSPACE');
});

test('createAnalysisServices: canonicalize resolves relative path and handles realpath', async () => {
  const tempDir = path.join(tmpdir(), `aevra-bridge-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  const subFile = path.join(tempDir, 'file.txt');
  writeFileSync(subFile, 'hello');

  try {
    const services = createAnalysisServices(tempDir, [
      {
        kind: 'workspace',
        id: 'r1',
        logicalPrefix: '/app',
        hostRoot: tempDir,
        capabilities: ['commands.run'],
      },
    ]);

    // Logical cwd is mapped explicitly, while raw operands retain native semantics.
    const cwdInside = await services.canonicalizeCwd?.('/app', mockCtx);
    assert.equal(cwdInside?.scope, 'inside');

    const resInside = await services.canonicalize('file.txt', '/app', 'read', mockCtx);
    assert.equal(resInside.scope, 'inside');

    // Relative path against cwd
    const resRel = await services.canonicalize('file.txt', '/app', 'read', mockCtx);
    assert.equal(resRel.scope, 'inside');

    // Non-existent relative path inside root (catches realpath and remains inside)
    const resNonExistent = await services.canonicalize('not-found.txt', '/app', 'read', mockCtx);
    assert.equal(resNonExistent.scope, 'inside');

    // Absolute path outside root
    const resOutside = await services.canonicalize('/etc/passwd', '/app', 'read', mockCtx);
    assert.equal(resOutside.scope, 'outside');

    // readConfig: returns fingerprint for existing file, null for missing
    const pkg = await services.readConfig('file.txt', 1024, mockCtx);
    assert.ok(pkg?.fingerprint);
    assert.equal(pkg?.text, 'hello');

    const missing = await services.readConfig('non-existent.json', 1024, mockCtx);
    assert.equal(missing, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createAnalysisServices: readConfig returns null if workspaceRoot is undefined', async () => {
  const services = createAnalysisServices();
  assert.equal(await services.readConfig('package.json', 1024, mockCtx), null);
});

test('createAnalysisServices: production root keeps native operands native and resolves relative operands from cwd', async () => {
  const tempDir = path.join(tmpdir(), `aevra-root-map-${Date.now()}`);
  const outsideDir = path.join(tmpdir(), `aevra-root-map-out-${Date.now()}`);
  mkdirSync(path.join(tempDir, 'sub'), { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  const insideFile = path.join(tempDir, 'sub', 'inside.txt');
  const outsideFile = path.join(outsideDir, 'outside.txt');
  writeFileSync(insideFile, 'inside');
  writeFileSync(outsideFile, 'outside');

  try {
    const services = createAnalysisServices(tempDir, [
      {
        kind: 'workspace',
        id: 'root',
        logicalPrefix: '/',
        hostRoot: tempDir,
        capabilities: ['commands.run'],
      },
    ]);

    const cwdRoot = await services.canonicalizeCwd?.('/', mockCtx);
    const cwdSub = await services.canonicalizeCwd?.('/sub', mockCtx);
    assert.equal(cwdRoot?.scope, 'inside');
    assert.equal(path.resolve(cwdRoot?.canonicalPath ?? ''), await realpath(tempDir));
    assert.equal(cwdSub?.scope, 'inside');

    const relative = await services.canonicalize('inside.txt', '/sub', 'read', mockCtx);
    assert.equal(relative.scope, 'inside');
    assert.equal(path.resolve(relative.canonicalPath!), await realpath(insideFile));

    const absoluteOutside = await services.canonicalize(outsideFile, '/sub', 'read', mockCtx);
    assert.equal(absoluteOutside.scope, 'outside');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('createAnalysisServices: nonexistent child through escaping symlink parent is not inside', async () => {
  const tempDir = path.join(tmpdir(), `aevra-link-root-${Date.now()}`);
  const outsideDir = path.join(tmpdir(), `aevra-link-out-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  symlinkSync(
    outsideDir,
    path.join(tempDir, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  try {
    const services = createAnalysisServices(tempDir, [
      {
        kind: 'workspace',
        id: 'root',
        logicalPrefix: '/',
        hostRoot: tempDir,
        capabilities: ['commands.run'],
      },
    ]);
    const result = await services.canonicalize('link/new.txt', '/', 'write', mockCtx);
    assert.notEqual(result.scope, 'inside');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('createAnalysisServices: readConfig enforces maxBytes before returning content', async () => {
  const tempDir = path.join(tmpdir(), `aevra-config-bound-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(path.join(tempDir, 'package.json'), 'x'.repeat(4096));
  try {
    const services = createAnalysisServices(tempDir);
    assert.equal(await services.readConfig('package.json', 128, mockCtx), null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createAnalysisServices: sandbox analysis does not substitute a host executable identity', async () => {
  const services = createAnalysisServices(
    undefined,
    [],
    process.platform === 'win32' ? 'win32' : 'linux',
  );
  const identity = await services.resolveExecutable?.('node', '/', {
    ...mockCtx,
    platform: process.platform === 'win32' ? 'win32' : 'linux',
    backendId: 'sandbox',
  });
  assert.equal(identity, null);
});

test('evaluateAndDecideCommand: fingerprints the explicit executable path from argv[0]', async () => {
  const tempDir = path.join(tmpdir(), `aevra-explicit-exe-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  const executable = path.join(tempDir, process.platform === 'win32' ? 'git.exe' : 'git');
  writeFileSync(executable, 'fixture');

  try {
    const lease = { workspaceId: 'ws-1', capabilities: ['commands.run'] };
    const context: any = {
      sessions: {
        get: () => ({ actor: 'operator' }),
        activeLease: () => lease,
        leases: () => [lease],
      },
      workspaces: {
        getLocal: () => ({ id: 'ws-1', hostRoot: tempDir }),
        capabilityRoots: () => [
          { id: 'r1', logicalPrefix: '/', hostRoot: tempDir, capabilities: ['commands.run'] },
        ],
      },
      deps: { permissions: { listRules: () => [] } },
    };

    const { analysis } = await evaluateAndDecideCommand(context, 's1', {
      commandRequest: {
        kind: 'argv',
        argv: [executable, 'status'],
        cwdLogical: '/',
        executionMode: 'host',
      },
      permissionMatcher: 'git:status',
      rawDestinations: [],
      isYolo: false,
      yoloMode: 'workspace',
    });

    assert.equal(
      path.resolve(analysis.nodes[0]?.executable?.canonicalPath ?? ''),
      realpathSync(executable),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('evaluateAndDecideCommand: executable identity honors request PATH override', async () => {
  const tempDir = path.join(tmpdir(), `aevra-path-exe-${Date.now()}`);
  const binDir = path.join(tempDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const executable = path.join(
    binDir,
    process.platform === 'win32' ? 'fixture-tool.EXE' : 'fixture-tool',
  );
  writeFileSync(executable, 'fixture');

  try {
    const lease = { workspaceId: 'ws-1', capabilities: ['commands.run'] };
    const context: any = {
      sessions: {
        get: () => ({ actor: 'operator' }),
        activeLease: () => lease,
        leases: () => [lease],
      },
      workspaces: {
        getLocal: () => ({ id: 'ws-1', hostRoot: tempDir }),
        capabilityRoots: () => [
          { id: 'r1', logicalPrefix: '/', hostRoot: tempDir, capabilities: ['commands.run'] },
        ],
      },
      deps: { permissions: { listRules: () => [] } },
    };

    const { analysis } = await evaluateAndDecideCommand(context, 's1', {
      commandRequest: {
        kind: 'argv',
        argv: ['fixture-tool', '--version'],
        cwdLogical: '/',
        env: {
          PATH: binDir,
          ...(process.platform === 'win32' ? { PATHEXT: '.EXE' } : {}),
        },
        executionMode: 'host',
      },
      permissionMatcher: 'fixture-tool',
      rawDestinations: [],
      isYolo: false,
      yoloMode: 'workspace',
    });

    assert.equal(
      path.resolve(analysis.nodes[0]?.executable?.canonicalPath ?? ''),
      realpathSync(executable),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
