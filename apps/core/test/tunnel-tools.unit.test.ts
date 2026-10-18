import assert from 'node:assert/strict';
import test from 'node:test';
import type { CapabilityProbeRunner } from '../src/system/capability-detector.js';
import { detectTunnelTools } from '../src/system/tunnel-tools.js';

type Reply = { exitCode: number | null; stdout?: string; timedOut?: boolean } | Error;

function runner(replies: Record<string, Reply>): CapabilityProbeRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(executable, args) {
      calls.push(`${executable} ${args.join(' ')}`);
      const reply = replies[executable];
      if (!reply || reply instanceof Error) throw reply ?? new Error('not found');
      return {
        exitCode: reply.exitCode,
        stdout: reply.stdout ?? '',
        stderr: '',
        timedOut: reply.timedOut ?? false,
      };
    },
  };
}

test('reports both tunnel tools with versions and prefers cloudflared', async () => {
  const fake = runner({
    cloudflared: { exitCode: 0, stdout: 'cloudflared version 2026.5.2 (built 2026-05-01)' },
    ngrok: { exitCode: 0, stdout: 'ngrok version 3.22.1' },
  });
  const result = await detectTunnelTools({ runner: fake });
  assert.deepEqual(result, {
    cloudflared: { available: true, version: '2026.5.2' },
    ngrok: { available: true, version: '3.22.1' },
    recommended: 'cloudflared',
  });
  assert.deepEqual(fake.calls.sort(), ['cloudflared --version', 'ngrok --version']);
});

test('missing, failing, and timed-out probes count as not found', async () => {
  const missing = await detectTunnelTools({
    runner: runner({ cloudflared: new Error('ENOENT'), ngrok: { exitCode: 0, stdout: 'ngrok' } }),
  });
  assert.deepEqual(missing, {
    cloudflared: { available: false },
    ngrok: { available: true },
    recommended: 'ngrok',
  });

  const none = await detectTunnelTools({
    runner: runner({
      cloudflared: { exitCode: 1 },
      ngrok: { exitCode: null, timedOut: true },
    }),
  });
  assert.deepEqual(none, {
    cloudflared: { available: false },
    ngrok: { available: false },
    recommended: null,
  });
});
