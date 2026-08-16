import assert from 'node:assert/strict';
import test from 'node:test';
import { runStatusCommand } from '../src/commands/status-command.js';

function response(
  options: {
    ok?: boolean;
    status?: number;
    body?: Record<string, unknown>;
  } = {},
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() {
      return options.body ?? {};
    },
  };
}

test('status prints provider-neutral exposure rows in text mode', async () => {
  const logs: string[] = [];
  const errors: string[] = [];

  const code = await runStatusCommand(
    { stateDir: 'x' },
    { command: 'status', json: false },
    {
      fetch: async (_config, path) => {
        assert.equal(path, '/api/exposure/status');
        return response({
          body: {
            provider: 'ngrok',
            state: 'ready',
            publicUrl: 'https://aevra.ngrok.app',
            localGatewayUrl: 'https://localhost:47830',
          },
        });
      },
      log: (value) => logs.push(value),
      error: (value) => errors.push(value),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(logs, [
    'Exposure: ngrok',
    'State: ready',
    'Public: https://aevra.ngrok.app',
    'Gateway: https://localhost:47830',
  ]);
  assert.deepEqual(errors, []);
});

test('status prints structured exposure status in json mode', async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const body = { provider: 'external', state: 'ready', publicUrl: 'https://aevra.example.com' };

  const code = await runStatusCommand(
    {},
    { command: 'status', json: true },
    {
      fetch: async (_config, path) => {
        assert.equal(path, '/api/exposure/status');
        return response({ body });
      },
      log: (value) => logs.push(value),
      error: (value) => errors.push(value),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(logs[0]!), body);
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
