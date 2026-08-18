import assert from 'node:assert/strict';
import test from 'node:test';
import { runStartCommand } from '../src/commands/start-command.js';

function fixture(openError?: string) {
  const errors: string[] = [];
  let opened = 0;
  return {
    errors,
    get opened() {
      return opened;
    },
    dependencies: {
      run: async (
        _config: object,
        hooks: {
          onReady(info: { adminUrl: string; mcpUrl: string }): void | Promise<void>;
        },
      ) => {
        await hooks.onReady({
          adminUrl: 'https://localhost:47831',
          mcpUrl: 'https://localhost:47832',
        });
        return 4;
      },
      readyLines: (info: { adminUrl: string; mcpUrl: string }) => [
        `ready ${info.adminUrl}`,
        `mcp ${info.mcpUrl}`,
      ],
      openUi: async () => {
        opened += 1;
        if (openError) throw new Error(openError);
      },
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}

test('start prints readiness and opens UI when requested', async () => {
  const state = fixture();
  const code = await runStartCommand({}, { command: 'start', ui: true }, state.dependencies);

  assert.equal(code, 4);
  assert.equal(state.opened, 1);
  assert.deepEqual(state.errors, [
    'ready https://localhost:47831',
    'mcp https://localhost:47832',
  ]);
});

test('start does not open UI when flag is absent', async () => {
  const state = fixture();
  const code = await runStartCommand({}, { command: 'start', ui: false }, state.dependencies);

  assert.equal(code, 4);
  assert.equal(state.opened, 0);
});

test('start keeps running when automatic UI launch fails', async () => {
  const state = fixture('browser unavailable');
  const code = await runStartCommand({}, { command: 'start', ui: true }, state.dependencies);

  assert.equal(code, 4);
  assert.match(state.errors.at(-1)!, /UI launch failed: browser unavailable/);
});
