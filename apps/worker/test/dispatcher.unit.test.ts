import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { VerifiedEnvelope, WorkerOperation } from '../../../packages/protocol/src/worker.js';
import { dispatchWorkerOperation } from '../src/dispatcher.js';

function envelope(
  root: string,
  operation: WorkerOperation,
  executionMode: 'host' | 'sandbox' = 'host',
) {
  return {
    version: 1,
    daemonInstanceId: 'daemon',
    operationId: 'op',
    sessionId: 'session',
    workspaceId: 'workspace',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: 'nonce',
    executionMode,
    capabilityRoots: [
      {
        id: 'root',
        kind: 'workspace',
        logicalPrefix: '/',
        hostRoot: root,
        capabilities: [
          'files.read',
          'files.search',
          'files.write',
          'files.delete',
          'commands.run',
          'git.read',
          'git.write',
          'git.push',
        ],
      },
    ],
    operation,
    mac: 'mac',
    verifiedAt: new Date().toISOString(),
  } as VerifiedEnvelope;
}

async function ok(root: string, operation: WorkerOperation) {
  const result = await dispatchWorkerOperation(envelope(root, operation));
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
  return (result as { ok: true; value: any }).value;
}

test('worker dispatcher executes file read search create write move and delete operations', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-dispatch-'));
  try {
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'a.txt'), 'alpha\nbeta\n');

    const listed = await ok(root, { kind: 'file.list', path: '/src' });
    assert.ok(listed.some((entry: any) => entry.name === 'a.txt'));

    const read = await ok(root, { kind: 'file.read', path: '/src/a.txt', offset: 0, length: 5 });
    assert.equal(read.content, 'alpha');

    const searched = await ok(root, { kind: 'file.search', path: '/src', query: 'beta' });
    assert.ok(searched.length > 0);

    const multi = await ok(root, {
      kind: 'search.multi',
      queries: [{ value: 'alpha', mode: 'text', path: '/src' }],
      maxResultsPerQuery: 5,
    });
    assert.equal(multi.results.length, 1);

    await ok(root, {
      kind: 'file.create',
      path: '/src/b.txt',
      content: 'created',
      encoding: 'utf8',
    });
    await ok(root, {
      kind: 'file.write',
      path: '/src/b.txt',
      content: 'written',
      encoding: 'utf8',
    });
    await ok(root, { kind: 'file.move', from: '/src/b.txt', to: '/src/c.txt' });
    assert.equal(readFileSync(path.join(root, 'src', 'c.txt'), 'utf8'), 'written');
    await ok(root, { kind: 'file.delete', path: '/src/c.txt', recursive: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worker dispatcher executes host commands recovery and inspection operations', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-dispatch-'));
  try {
    writeFileSync(path.join(root, 'state.txt'), 'before');
    const command = await ok(root, {
      kind: 'command.run',
      command: {
        executable: process.execPath,
        args: ['-e', "process.stdout.write('dispatch-ok')"],
        env: {},
      },
    });
    assert.equal(command.exitCode, 0);
    assert.equal(command.stdout, 'dispatch-ok');

    assert.deepEqual(await ok(root, { kind: 'sandbox.inspect' }), {
      ready: true,
      backend: 'worker',
    });
    assert.deepEqual(await ok(root, { kind: 'process.list' }), []);

    const snapshot = path.join(root, 'snapshot.txt');
    await ok(root, { kind: 'recovery.snapshot', path: '/state.txt', destination: snapshot });
    writeFileSync(path.join(root, 'state.txt'), 'changed');
    await ok(root, { kind: 'recovery.restore', snapshot, path: '/state.txt' });
    assert.equal(readFileSync(path.join(root, 'state.txt'), 'utf8'), 'before');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worker dispatcher returns stable errors for invalid operations and escaped roots', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-dispatch-'));
  try {
    const missing = await dispatchWorkerOperation(
      envelope(root, { kind: 'file.read', path: '/missing' }),
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.ok(missing.error.message.length > 0);

    const unknown = await dispatchWorkerOperation(
      envelope(root, { kind: 'unknown.operation' } as unknown as WorkerOperation),
    );
    assert.deepEqual(unknown, {
      ok: false,
      error: {
        code: 'CAPABILITY_REQUIRED',
        message: 'Operation unknown.operation is not enabled yet',
      },
    });

    const escaped = envelope(root, {
      kind: 'command.run',
      command: { executable: process.execPath, args: ['-e', ''], env: {} },
    });
    escaped.capabilityRoots = [];
    const denied = await dispatchWorkerOperation(escaped);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, 'WORKSPACE_ESCAPE');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worker dispatcher handles hook run process lifecycle and sandbox rejection', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-dispatch-ops-'));
  try {
    const hookRes = await ok(root, {
      kind: 'hook.run',
      event: 'test_event',
      hookKind: 'command',
      executable: process.execPath,
      args: ['-e', "process.stdout.write('hook-ok')"],
      env: {},
      timeoutMs: 5000,
      execution: 'run',
      context: {},
      payload: { data: 1 },
    });
    assert.equal(hookRes.exitCode, 0);

    const proc = await ok(root, {
      kind: 'process.start',
      command: {
        executable: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 1000)'],
        env: {},
      },
      lifecycle: 'stop-with-aevra',
    });
    assert.ok(proc.processId);

    const status = await ok(root, { kind: 'process.status', processId: proc.processId });
    assert.ok(status);

    const logs = await ok(root, { kind: 'process.logs', processId: proc.processId, cursor: '0' });
    assert.ok(Array.isArray(logs.lines));

    const stopped = await ok(root, { kind: 'process.stop', processId: proc.processId });
    assert.ok(stopped);
    await ok(root, { kind: 'process.wait', processId: proc.processId, timeoutMs: 2000 });

    // Sandbox execution when no docker/podman is available
    const sbxResult = await dispatchWorkerOperation(
      envelope(
        root,
        {
          kind: 'command.run',
          command: { executable: 'echo', args: ['hi'], env: {} },
          sandboxBackend: 'docker',
        },
        'sandbox',
      ),
    );
    if (!sbxResult.ok) {
      assert.equal(sbxResult.error.code, 'EXECUTOR_UNAVAILABLE');
    }

    // Git operations through dispatcher
    await ok(root, {
      kind: 'command.run',
      command: { executable: 'git', args: ['init'], env: {} },
    });
    await ok(root, {
      kind: 'command.run',
      command: { executable: 'git', args: ['config', 'user.name', 'Tester'], env: {} },
    });
    await ok(root, {
      kind: 'command.run',
      command: { executable: 'git', args: ['config', 'user.email', 'test@example.com'], env: {} },
    });

    writeFileSync(path.join(root, 'git-test.txt'), 'hello');
    await ok(root, {
      kind: 'command.run',
      command: { executable: 'git', args: ['add', 'git-test.txt'], env: {} },
    });

    const gitStatusResult = await ok(root, { kind: 'git.status' });
    assert.equal(gitStatusResult.exitCode, 0);

    const gitDiffResult = await ok(root, { kind: 'git.diff', args: ['--cached'] });
    assert.equal(gitDiffResult.exitCode, 0);

    const gitCommitResult = await ok(root, {
      kind: 'git.commit',
      message: 'test commit',
      args: [],
    });
    assert.equal(gitCommitResult.exitCode, 0);

    const gitLogResult = await ok(root, { kind: 'git.log', args: [] });
    assert.equal(gitLogResult.exitCode, 0);

    const gitBranchResult = await ok(root, { kind: 'git.branch', args: [] });
    assert.equal(gitBranchResult.exitCode, 0);

    const gitPushResult = await ok(root, {
      kind: 'git.push',
      remote: 'origin',
      branch: 'main',
      args: [],
    });
    assert.ok(gitPushResult);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
});
