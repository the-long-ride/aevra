import assert from 'node:assert/strict';
import test from 'node:test';
import { runConnectionsCommand } from '../src/commands/connections-command.js';

function response(body: unknown = {}, ok = true, status = 200) {
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

test('connections list reports empty state when no active connections', async () => {
  const state = fixture(async () => response([]));
  const code = await runConnectionsCommand(
    {},
    { command: 'connections', action: 'list' },
    state.dependencies,
  );
  assert.equal(code, 0);
  assert.equal(state.logs[0], 'No active connections.');
});

test('connections list filters out revoked connections and displays active details', async () => {
  const state = fixture(async () =>
    response([
      { id: 'c1', client: 'ChatGPT', status: 'ACTIVE', lastActivityAt: '2026-09-20T00:00:00Z' },
      { id: 'c2', client: 'Claude', status: 'REVOKED' },
      { id: 'c3', actor: 'Custom', status: 'ACTIVE' },
    ]),
  );
  const code = await runConnectionsCommand(
    {},
    { command: 'connections', action: 'list' },
    state.dependencies,
  );
  assert.equal(code, 0);
  assert.equal(state.logs.length, 2);
  assert.match(state.logs[0]!, /c1\s+ChatGPT/);
  assert.match(state.logs[1]!, /c3\s+Custom/);
});

test('connections list handles API error', async () => {
  const state = fixture(async () => response({}, false, 500));
  const code = await runConnectionsCommand(
    {},
    { command: 'connections', action: 'list' },
    state.dependencies,
  );
  assert.equal(code, 1);
  assert.match(state.errors[0]!, /connections failed/);
});

test('connections revoke calls API and logs success', async () => {
  const calls: Array<{ path: string; method?: string }> = [];
  const state = fixture(async (_config, path, init) => {
    calls.push({ path, method: init?.method });
    return response({ ok: true });
  });
  const code = await runConnectionsCommand(
    {},
    { command: 'connections', action: 'revoke', id: 'conn-123' },
    state.dependencies,
  );
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, '/api/connections/conn-123/revoke');
  assert.equal(calls[0]!.method, 'POST');
  assert.match(state.logs[0]!, /Revoked connection conn-123/);
});

test('connections revoke handles failure', async () => {
  const state = fixture(async () => response({}, false, 404));
  const code = await runConnectionsCommand(
    {},
    { command: 'connections', action: 'revoke', id: 'conn-bad' },
    state.dependencies,
  );
  assert.equal(code, 1);
  assert.match(state.errors[0]!, /connections failed/);
});
