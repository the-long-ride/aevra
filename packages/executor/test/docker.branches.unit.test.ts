import assert from 'node:assert/strict';
import test from 'node:test';
import { DockerBackend } from '../src/docker.js';

// Points the backend at a local executable so run() and available() execute
// their argument building and result handling without a container engine.
class LocalBackend extends DockerBackend {
  constructor(executable: string) {
    super();
    this.executable = executable;
  }
}

const workspaceRoot = {
  id: 'workspace',
  kind: 'workspace',
  logicalPrefix: '/',
  hostRoot: process.cwd(),
  capabilities: ['commands.run'],
} as any;

function prepareInput(roots: any[]) {
  return { workspaceId: 'test', roots, cachePolicy: 'disabled' } as any;
}

test('prepare, inspect, network policy and terminate track sandbox state', async () => {
  const backend = new DockerBackend();
  const handle = await backend.prepare(prepareInput([workspaceRoot]));
  assert.equal(handle.backend, 'docker');
  assert.deepEqual(await backend.inspect(handle), {
    ready: true,
    image: 'node:22-alpine',
    networkPolicyApplied: true,
  });
  await backend.applyNetworkPolicy(handle, { mode: 'allow-list', destinations: ['example.test'] } as any);
  assert.equal((await backend.inspect(handle)).networkPolicyApplied, false);
  await backend.applyNetworkPolicy(handle, { mode: 'deny-all', destinations: [] } as any);
  assert.equal((await backend.inspect(handle)).networkPolicyApplied, true);
  await backend.terminate(handle);
  assert.deepEqual(await backend.inspect(handle), {
    ready: false,
    image: '',
    networkPolicyApplied: false,
  });
  await assert.rejects(
    () => backend.applyNetworkPolicy(handle, { mode: 'deny-all', destinations: [] } as any),
    /sandbox not prepared/,
  );
  await assert.rejects(
    () => backend.run(handle, { executable: 'x', args: [], env: {} }),
    /sandbox not prepared/,
  );
  await assert.rejects(() => backend.startProcess(), /requires process host/);
});

test('run requires a workspace root', async () => {
  const backend = new DockerBackend();
  const handle = await backend.prepare(prepareInput([{ ...workspaceRoot, kind: 'mount' }]));
  await assert.rejects(
    () => backend.run(handle, { executable: 'x', args: [], env: {} }),
    /workspace root missing/,
  );
});

test('run reports the engine exit code and redacts env values from output', async () => {
  // node rejects the docker-style argv (`run --rm ...`) and exits non-zero.
  const backend = new LocalBackend(process.execPath);
  const handle = await backend.prepare(prepareInput([workspaceRoot]));
  await backend.applyNetworkPolicy(handle, { mode: 'allow-list', destinations: [] } as any);
  const result = await backend.run(handle, {
    executable: 'echo',
    args: ['words'],
    env: { SAMPLE_NAME: 'sample value' },
    timeoutMs: 20_000,
  });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.ok(result.durationMs >= 0);
  assert.equal(result.stderr.includes('sample value'), false);

  // deny-all (the prepared default) adds --network none; empty env adds no -e flags.
  const isolated = await backend.prepare(prepareInput([workspaceRoot]));
  const denied = await backend.run(isolated, { executable: 'echo', args: [], env: {} });
  assert.notEqual(denied.exitCode, 0);
});

test('available is false for a failing or missing engine executable', async () => {
  assert.equal(await new LocalBackend(process.execPath).available(), false);
  assert.equal(await new LocalBackend('aevra-no-such-engine').available(), false);
});
