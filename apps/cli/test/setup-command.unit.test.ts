import assert from 'node:assert/strict';
import test from 'node:test';
import { runSetupCommand } from '../src/commands/setup-command.js';

function resources(answers: string[], options: { found?: boolean } = {}) {
  const prompts: string[] = [];
  const configs: Array<Record<string, unknown>> = [];
  const cloudflareSetups: Array<Record<string, unknown>> = [];
  let closed = 0;
  let cloudflareDetections = 0;
  const queue = [...answers];
  return {
    prompts,
    configs,
    cloudflareSetups,
    get closed() {
      return closed;
    },
    get cloudflareDetections() {
      return cloudflareDetections;
    },
    value: {
      prompt: {
        async question(text: string) {
          prompts.push(text);
          return queue.shift() ?? '';
        },
      },
      configure(config: Record<string, unknown>) {
        configs.push(config);
      },
      cloudflare: {
        detectCloudflared: async () => {
          cloudflareDetections++;
          return { found: options.found ?? true, version: '2026.5.2' };
        },
        authenticate: async () => ({ code: 0, stderr: '' }),
        setup: async (input: Record<string, unknown>) => {
          cloudflareSetups.push(input);
          return {
            ...input,
            hostname: String(input.hostname),
            ownership: input.ownership ?? 'managed',
          };
        },
      },
      close() {
        closed += 1;
      },
    },
  };
}

function fixture(resource: ReturnType<typeof resources>, interactive = true) {
  const errors: string[] = [];
  return {
    errors,
    dependencies: {
      isInteractive: () => interactive,
      prepare: () => resource.value,
      needsAccess: (value: string) => value.trim().toLowerCase() === 'access',
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}

test('setup rejects non-interactive terminals', async () => {
  const resource = resources([]);
  const state = fixture(resource, false);
  const code = await runSetupCommand({}, { command: 'setup' }, state.dependencies);
  assert.equal(code, 1);
  assert.equal(resource.closed, 0);
  assert.match(state.errors[0]!, /interactive terminal/);
});

test('setup defaults to local exposure without probing Cloudflare', async () => {
  const resource = resources(['']);
  const state = fixture(resource);
  const code = await runSetupCommand({}, { command: 'setup' }, state.dependencies);
  assert.equal(code, 0);
  assert.deepEqual(resource.configs, [{ provider: 'local' }]);
  assert.equal(resource.cloudflareDetections, 0);
  assert.equal(resource.closed, 1);
});

test('setup configures external exposure from one HTTPS public URL', async () => {
  const resource = resources(['external', 'https://aevra.example.com']);
  const state = fixture(resource);
  const code = await runSetupCommand({}, { command: 'setup' }, state.dependencies);
  assert.equal(code, 0);
  assert.deepEqual(resource.configs, [
    { provider: 'external', publicUrl: 'https://aevra.example.com' },
  ]);
  assert.equal(resource.cloudflareDetections, 0);
});

test('setup configures managed ngrok without requesting a public URL', async () => {
  const resource = resources(['ngrok', '']);
  const state = fixture(resource);
  const code = await runSetupCommand({}, { command: 'setup' }, state.dependencies);
  assert.equal(code, 0);
  assert.deepEqual(resource.configs, [{ provider: 'ngrok', ngrok: { ownership: 'managed' } }]);
  assert.equal(resource.cloudflareDetections, 0);
});

test('setup Cloudflare Access collects verifier values and writes provider-neutral exposure', async () => {
  const resource = resources([
    'cloudflare',
    'n',
    'mcp.example.com',
    'tunnel-1',
    'access',
    'https://team.cloudflareaccess.com',
    'aud-1',
    'external',
  ]);
  const state = fixture(resource);
  const code = await runSetupCommand({}, { command: 'setup' }, state.dependencies);
  assert.equal(code, 0);
  assert.equal(resource.cloudflareSetups[0]!.authMode, 'access');
  assert.deepEqual(resource.configs, [
    {
      provider: 'cloudflare',
      publicUrl: 'https://mcp.example.com',
      cloudflare: {
        tunnelId: 'tunnel-1',
        hostname: 'mcp.example.com',
        ownership: 'external',
        authMode: 'access',
        issuer: 'https://team.cloudflareaccess.com',
        audience: 'aud-1',
      },
    },
  ]);
});
