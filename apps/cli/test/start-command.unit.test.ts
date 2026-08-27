import assert from 'node:assert/strict';
import test from 'node:test';
import { runStartCommand } from '../src/commands/start-command.js';

function fixture(openError?: string) {
  const errors: string[] = [];
  const destinations: Array<'/'> = [];
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
      openUi: async (_config: object, destination: '/') => {
        if (openError) throw new Error(openError);
        destinations.push(destination);
        errors.push(`opening ${destination}`);
      },
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}

test('start opens the React admin root and prints the stop hint last', async () => {
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
    'opening /',
    '[aevra] Press Ctrl+C to stop Aevra.',
  ]);
});

test('start prints the stop hint after ready output when UI flag is absent', async () => {
  const state = fixture();
  const code = await runStartCommand(
    {},
    { command: 'start', uiDestination: null },
    state.dependencies,
  );

  assert.equal(code, 4);
  assert.deepEqual(state.destinations, []);
  assert.equal(state.errors.at(-1), '[aevra] Press Ctrl+C to stop Aevra.');
});

test('start keeps running when automatic UI launch fails and prints the stop hint last', async () => {
  const state = fixture('browser unavailable');
  const code = await runStartCommand(
    {},
    { command: 'start', uiDestination: '/' },
    state.dependencies,
  );

  assert.equal(code, 4);
  assert.match(state.errors.at(-2)!, /UI launch failed: browser unavailable/);
  assert.equal(state.errors.at(-1), '[aevra] Press Ctrl+C to stop Aevra.');
});

test('start prints a friendly runtime error instead of crashing', async () => {
  const state = fixture();
  state.dependencies.run = async () => {
    throw Object.assign(
      new Error(
        'ADMIN_CREDENTIALS_REQUIRED: AEVRA_USERNAME and AEVRA_PASSWORD must both be configured',
      ),
      { code: 'ADMIN_CREDENTIALS_REQUIRED' },
    );
  };
  const code = await runStartCommand(
    {},
    { command: 'start', uiDestination: null },
    state.dependencies,
  );
  assert.equal(code, 1);
  assert.equal(
    state.errors[0],
    '[aevra] ADMIN_CREDENTIALS_REQUIRED: AEVRA_USERNAME and AEVRA_PASSWORD must both be configured',
  );
});
