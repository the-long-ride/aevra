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

const EXPOSURE = {
  provider: 'ngrok',
  state: 'ready',
  publicUrl: 'https://aevra.ngrok.app',
  localGatewayUrl: 'https://localhost:47830',
};

/**
 * Routes by path rather than asserting one, because status now asks two
 * questions: how Aevra is exposed, and whether a browser extension is paired.
 */
function router(browser: ReturnType<typeof response> | null) {
  const paths: string[] = [];
  return {
    paths,
    fetch: async (_config: unknown, path: string) => {
      paths.push(path);
      if (path === '/api/exposure/status') return response({ body: EXPOSURE });
      if (path === '/api/browser' && browser) return browser;
      throw new Error(`no route for ${path}`);
    },
  };
}

function harness(browser: ReturnType<typeof response> | null) {
  const logs: string[] = [];
  const errors: string[] = [];
  const routes = router(browser);
  return {
    logs,
    errors,
    paths: routes.paths,
    dependencies: {
      fetch: routes.fetch,
      log: (value: string) => logs.push(value),
      error: (value: string) => errors.push(value),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}

test('status prints provider-neutral exposure rows in text mode', async () => {
  const state = harness(response({ body: { extensionId: 'a'.repeat(32) } }));
  const code = await runStatusCommand(
    { stateDir: 'x' },
    { command: 'status', json: false },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.deepEqual(state.logs.slice(0, 4), [
    'Exposure: ngrok',
    'State: ready',
    'Public: https://aevra.ngrok.app',
    'Gateway: https://localhost:47830',
  ]);
  assert.deepEqual(state.errors, []);
});

test('a paired extension is reported by id, with no install prompt', async () => {
  const state = harness(response({ body: { extensionId: 'b'.repeat(32) } }));
  await runStatusCommand({}, { command: 'status', json: false }, state.dependencies);

  assert.ok(state.logs.some((line) => line.includes(`extension paired (${'b'.repeat(32)})`)));
  assert.ok(!state.logs.some((line) => line.includes('Download:')));
});

test('an unpaired browser gets the download and the guide, once', async () => {
  const state = harness(response({ body: { extensionId: null } }));
  await runStatusCommand({}, { command: 'status', json: false }, state.dependencies);

  const prompt = state.logs.filter((line) => line.includes('no extension paired'));
  assert.equal(prompt.length, 1);
  assert.ok(state.logs.some((line) => line.includes('/releases/latest')));
  assert.ok(state.logs.some((line) => line.includes('18-browser-control.md')));
});

test('a core without browser control still reports exposure and says nothing about browsers', async () => {
  const state = harness(null);
  const code = await runStatusCommand({}, { command: 'status', json: false }, state.dependencies);

  assert.equal(code, 0);
  assert.equal(state.logs.length, 4);
  assert.ok(!state.logs.some((line) => line.includes('Browser')));
});

test('a browser route that answers with an error is treated as unavailable', async () => {
  const state = harness(response({ ok: false, status: 503 }));
  const code = await runStatusCommand({}, { command: 'status', json: false }, state.dependencies);

  assert.equal(code, 0);
  assert.ok(!state.logs.some((line) => line.includes('Browser')));
});

test('status prints structured exposure status in json mode', async () => {
  const state = harness(response({ body: { extensionId: null } }));
  const code = await runStatusCommand({}, { command: 'status', json: true }, state.dependencies);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(state.logs[0]!), {
    ...EXPOSURE,
    browser: { paired: false, extensionId: null },
  });
  assert.deepEqual(state.errors, []);
});

test('json mode reports a missing browser route as null rather than omitting it', async () => {
  const state = harness(null);
  await runStatusCommand({}, { command: 'status', json: true }, state.dependencies);
  assert.equal(JSON.parse(state.logs[0]!).browser, null);
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
