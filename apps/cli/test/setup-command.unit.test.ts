import assert from 'node:assert/strict';
import test from 'node:test';
import { runSetupCommand } from '../src/commands/setup-command.js';

function resources(
  answers: string[],
  options: { found?: boolean } = {},
) {
  const prompts: string[] = [];
  const setups: Array<Record<string, unknown>> = [];
  let closed = 0;
  const queue = [...answers];
  return {
    prompts,
    setups,
    get closed() {
      return closed;
    },
    value: {
      prompt: {
        async question(text: string) {
          prompts.push(text);
          return queue.shift() ?? '';
        },
      },
      manager: {
        detectCloudflared: async () => ({
          found: options.found ?? true,
          version: '2026.5.2',
        }),
        authenticate: async () => ({ code: 0, stderr: '' }),
        setup: async (input: Record<string, unknown>) => {
          setups.push(input);
          return { hostname: String(input.hostname) };
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

test('setup connector mode omits Access verifier values', async () => {
  const resource = resources(['n', 'mcp.example.com', '', '', '']);
  const state = fixture(resource);

  const code = await runSetupCommand({}, { command: 'setup' }, state.dependencies);

  assert.equal(code, 0);
  assert.equal(resource.closed, 1);
  assert.deepEqual(resource.setups[0], {
    hostname: 'mcp.example.com',
    tunnelId: undefined,
    authMode: 'connector',
    ownership: 'managed',
    issuer: undefined,
    audience: undefined,
  });
});

test('setup access mode collects issuer and audience', async () => {
  const resource = resources([
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
  assert.equal(resource.setups[0]!.authMode, 'access');
  assert.equal(resource.setups[0]!.issuer, 'https://team.cloudflareaccess.com');
  assert.equal(resource.setups[0]!.audience, 'aud-1');
  assert.equal(resource.setups[0]!.ownership, 'external');
});
