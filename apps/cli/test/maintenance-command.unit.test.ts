import assert from 'node:assert/strict';
import test from 'node:test';
import { runMaintenanceCommand } from '../src/commands/maintenance-command.js';

function response(body: Record<string, unknown> = {}, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

function fixture(
  api: (
    config: object,
    path: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<ReturnType<typeof response>>,
) {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    dependencies: {
      api,
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}

test('audit clear requires explicit confirmation', async () => {
  const state = fixture(async () => response());

  const code = await runMaintenanceCommand(
    {},
    { command: 'audit', action: 'clear', yes: false },
    state.dependencies,
  );

  assert.equal(code, 1);
  assert.match(state.errors[0]!, /--yes/);
});

test('audit clear calls the admin API and reports removed rows', async () => {
  const calls: Array<{ path: string; method?: string }> = [];
  const state = fixture(async (_config, path, init) => {
    calls.push({ path, method: init?.method });
    return response({ removed: 3 });
  });

  const code = await runMaintenanceCommand(
    {},
    { command: 'audit', action: 'clear', yes: true },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.deepEqual(calls, [{ path: '/api/audit', method: 'DELETE' }]);
  assert.match(state.logs[0]!, /Cleared 3 audit event/);
});

test('sessions revoke-others reports preservation counts', async () => {
  const calls: Array<{ path: string; method?: string }> = [];
  const state = fixture(async (_config, path, init) => {
    calls.push({ path, method: init?.method });
    return response({
      revokedRemote: 2,
      revokedAdmin: 1,
      preservedConnectors: 4,
      preservedAdmin: 1,
    });
  });

  const code = await runMaintenanceCommand(
    {},
    { command: 'sessions', action: 'revoke-others', yes: true },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.deepEqual(calls, [{ path: '/api/sessions/revoke-others', method: 'POST' }]);
  assert.match(state.logs[0]!, /Revoked 2 remote and 1 admin/);
});
