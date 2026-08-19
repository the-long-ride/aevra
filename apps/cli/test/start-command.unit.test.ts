import assert from 'node:assert/strict';
import test from 'node:test';
import { runStartCommand } from '../src/commands/start-command.js';

function fixture(openError?: string) {
  const errors: string[] = [];
  const destinations: Array<'/' | '/react/'> = [];
  return {
    errors,
    destinations,
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
      openUi: async (_config: object, destination: '/' | '/react/') => {
        destinations.push(destination);
        if (openError) throw new Error(openError);
      },
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    },
  };
}

test('start opens the requested vanilla UI destination', async () => {
  const state = fixture();
  const code = await runStartCommand(
    {},
    { command: 'start', uiDestination: '/' },
    state.dependencies,
  );

  assert.equal(code, 4);
  assert.deepEqual(state.destinations, ['/']);
  assert.deepEqual(state.errors, [
    'ready https://localhost:47831',
    'mcp https://localhost:47832',
  ]);
});

test('start opens the requested React UI destination', async () => {
  const state = fixture();
  const code = await runStartCommand(
    {},
    { command: 'start', uiDestination: '/react/' },
    state.dependencies,
  );

  assert.equal(code, 4);
  assert.deepEqual(state.destinations, ['/react/']);
});

test('start does not open UI when flag is absent', async () => {
  const state = fixture();
  const code = await runStartCommand(
    {},
    { command: 'start', uiDestination: null },
    state.dependencies,
  );

  assert.equal(code, 4);
  assert.deepEqual(state.destinations, []);
});

test('start keeps running when automatic UI launch fails', async () => {
  const state = fixture('browser unavailable');
  const code = await runStartCommand(
    {},
    { command: 'start', uiDestination: '/react/' },
    state.dependencies,
  );

  assert.equal(code, 4);
  assert.match(state.errors.at(-1)!, /UI launch failed: browser unavailable/);
});
