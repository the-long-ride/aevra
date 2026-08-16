import assert from 'node:assert/strict';
import test from 'node:test';
import { runConnectorsCommand } from '../src/commands/connectors-command.js';

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

test('connectors list prints empty state', async () => {
  const state = fixture(async () => response([]));

  const code = await runConnectorsCommand(
    {},
    { command: 'connectors', action: 'list' },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.deepEqual(state.logs, ['No connectors.']);
});

test('connectors create prints one-time public URL when hostname exists', async () => {
  const calls: Array<{
    path: string;
    init?: { method?: string; headers?: Record<string, string>; body?: string };
  }> = [];
  const state = fixture(async (_config, path, init) => {
    calls.push({ path, init });
    if (path === '/api/connectors') {
      return response({ id: 'c1', name: 'ChatGPT', token: 'secret' });
    }
    if (path === '/api/cloudflare/status') {
      return response({ hostname: 'mcp.example.com' });
    }
    throw new Error(`unexpected ${path}`);
  });

  const code = await runConnectorsCommand(
    {},
    { command: 'connectors', action: 'create', name: 'ChatGPT' },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.equal(calls[0]!.init?.method, 'POST');
  assert.match(calls[0]!.init?.body ?? '', /ChatGPT/);
  assert.match(state.logs.join('\n'), /https:\/\/mcp\.example\.com\/mcp\/secret/);
  assert.match(state.logs.at(-1)!, /shown only once/);
});

test('connectors revoke calls delete', async () => {
  const calls: Array<{
    path: string;
    init?: { method?: string; headers?: Record<string, string>; body?: string };
  }> = [];
  const state = fixture(async (_config, path, init) => {
    calls.push({ path, init });
    return response();
  });

  const code = await runConnectorsCommand(
    {},
    { command: 'connectors', action: 'revoke', id: 'c1' },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.equal(calls[0]!.path, '/api/connectors/c1');
  assert.equal(calls[0]!.init?.method, 'DELETE');
  assert.match(state.logs[0]!, /Revoked c1/);
});
