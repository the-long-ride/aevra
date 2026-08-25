import test from 'node:test';
import assert from 'node:assert/strict';
import { PodmanBackend } from '../src/podman.js';
test('Podman backend availability is explicit', { timeout: 30_000 }, async (t) => {
  const d = new PodmanBackend();
  const available = await d.available();
  if (!available) {
    t.skip('podman unavailable');
    return;
  }
  assert.equal(available, true);
});
test('Podman sandbox applies timeout and DLP to command output', { timeout: 90_000 }, async (t) => {
  const d = new PodmanBackend();
  if (!(await d.available())) {
    t.skip('podman unavailable');
    return;
  }
  const handle = await d.prepare({
    workspaceId: 'test',
    roots: [
      {
        id: 'workspace',
        kind: 'workspace',
        logicalPrefix: '/',
        hostRoot: process.cwd(),
        capabilities: ['commands.run'],
      } as any,
    ],
    cachePolicy: 'disabled',
  });
  try {
    const secret = 'sandbox-secret-value-12345';
    const redacted = await d.run(handle, {
      executable: 'node',
      args: ['-e', 'process.stdout.write(process.env.SECRET||"")'],
      env: { SECRET: secret },
    });
    assert.equal(redacted.stdout.includes(secret), false);
    assert.match(redacted.stdout, /\[REDACTED\]/);
    const started = Date.now();
    const timed = await d.run(handle, {
      executable: 'node',
      args: ['-e', 'setTimeout(()=>{},5000)'],
      env: {},
      timeoutMs: 80,
    });
    assert.ok(Date.now() - started < 10_000);
    assert.ok(
      timed.signal !== null || timed.exitCode !== 0,
      'timed out sandbox command must not report normal success',
    );
  } finally {
    await d.terminate(handle);
  }
});
