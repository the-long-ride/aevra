import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExposureConfig } from '../../core/src/exposure/types.js';
import { runSetupCommand } from '../src/commands/setup-command.js';

function fixture(answers: string[]) {
  const queue = [...answers];
  const prompts: string[] = [];
  const configs: ExposureConfig[] = [];
  const errors: string[] = [];
  let closed = false;
  const resources = {
    prompt: {
      async question(text: string) {
        prompts.push(text);
        return queue.shift() ?? '';
      },
    },
    cloudflare: {
      detectCloudflared: async () => ({ found: true, version: 'test' }),
      authenticate: async () => ({ code: 0, stderr: '' }),
      setup: async (input: any) => ({ ...input, hostname: String(input.hostname) }),
    },
    configure(config: ExposureConfig) {
      configs.push(config);
    },
    close() {
      closed = true;
    },
  };
  return {
    prompts,
    configs,
    errors,
    get closed() {
      return closed;
    },
    dependencies: {
      isInteractive: () => true,
      prepare: () => resources,
      needsAccess: (value: string) => value === 'access',
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}

test('setup can select HTTP for the local gateway and explains the HTTPS service boundary', async () => {
  const state = fixture(['local', 'http']);
  const code = await runSetupCommand({}, { command: 'setup' }, state.dependencies);

  assert.equal(code, 0);
  assert.deepEqual(state.configs, [{ provider: 'local', localProtocol: 'http' }]);
  assert.ok(state.prompts.some((prompt) => /local gateway protocol/i.test(prompt)));
  assert.ok(
    state.errors.some(
      (message) => /HTTP.*local gateway/i.test(message) && /Admin.*MCP.*HTTPS/i.test(message),
    ),
  );
  assert.equal(state.closed, true);
});

test('setup defaults local gateway protocol to HTTPS', async () => {
  const state = fixture(['local', '']);
  const code = await runSetupCommand({}, { command: 'setup' }, state.dependencies);

  assert.equal(code, 0);
  assert.deepEqual(state.configs, [{ provider: 'local', localProtocol: 'https' }]);
});
