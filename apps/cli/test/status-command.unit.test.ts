import assert from 'node:assert/strict';
import test from 'node:test';
import { runStatusCommand } from '../src/commands/status-command.js';

function response(options: {
  ok?: boolean;
  status?: number;
  body?: Record<string, unknown>;
} = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() {
      return options.body ?? {};
    },
  };
}

test('status prints key value rows in text mode', async () => {
  const logs: string[] = [];
  const errors: string[] = [];

  const code = await runStatusCommand(
    { stateDir: 'x' },
    { command: 'status', json: false },
    {
      fetch: async (_config, path) => {
        assert.equal(path, '/api/health');
        return response({ body: { core: 'ready', sessions: 2 } });
      },
      log: (value) => logs.push(value),
      error: (value) => errors.push(value),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(logs, ['core: ready', 'sessions: 2']);
  assert.deepEqual(errors, []);
});

test('status prints structured unreachable result in json mode', async () => {
  const logs: string[] = [];
  const errors: string[] = [];

  const code = await runStatusCommand(
    {},
    { command: 'status', json: true },
    {
      fetch: async () => {
        throw new Error('offline');
      },
      log: (value) => logs.push(value),
      error: (value) => errors.push(value),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
    },
  );

  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(logs[0]!), {
    core: 'unreachable',
    error: 'offline',
  });
  assert.deepEqual(errors, []);
});

test('status reports non-json failures to stderr', async () => {
  const errors: string[] = [];

  const code = await runStatusCommand(
    {},
    { command: 'status', json: false },
    {
      fetch: async () => response({ ok: false, status: 503 }),
      log: () => {},
      error: (value) => errors.push(value),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
    },
  );

  assert.equal(code, 1);
  assert.match(errors[0]!, /Core returned 503/);
  assert.match(errors[0]!, /Is aevra start\/service running\?/);
});
