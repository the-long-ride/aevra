import assert from 'node:assert/strict';
import test from 'node:test';
import { runMcpAccept, runMcpReview } from '../src/commands/mcp-review-command.js';

function response(body: unknown = {}, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}
const diff = { added: ['tool:search'], removed: ['resource:repo:///readme'], changed: [] };
function row(extra: Record<string, unknown> = {}) {
  return {
    id: 'mu_1',
    name: 'github',
    state: 'needs-review',
    enabled: true,
    pendingCatalogDiff: diff,
    pendingCatalogFingerprint: 'fingerprint-one-two-three',
    ...extra,
  };
}
function fixture(upstreams: unknown[], post: () => ReturnType<typeof response> = () => response()) {
  const logs: string[] = [],
    errors: string[] = [],
    calls: { path: string; init?: any }[] = [],
    order: string[] = [];
  return {
    logs,
    errors,
    order,
    calls,
    posts: () => calls.filter((call) => call.init?.method === 'POST'),
    dependencies: {
      api: async (_config: object, path: string, init?: any) => {
        calls.push({ path, init });
        if (init?.method === 'POST') order.push('POST');
        return init?.method === 'POST' ? post() : response({ upstreams });
      },
      log: (message: string) => (logs.push(message), order.push(message)),
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}

test('review of an unknown id errors and exits 1', async () => {
  const state = fixture([row()]);
  assert.equal(await runMcpReview({}, 'nope', state.dependencies), 1);
  assert.deepEqual(state.errors, ['[aevra] No MCP server nope']);
  assert.equal(state.posts().length, 0);
});
test('accept of an unknown id errors and exits 1 without a POST', async () => {
  const state = fixture([row()]);
  assert.equal(await runMcpAccept({}, 'nope', true, state.dependencies), 1);
  assert.deepEqual(state.errors, ['[aevra] No MCP server nope']);
  assert.equal(state.posts().length, 0);
});
test('review of a server that is not pending exits 0', async () => {
  const state = fixture([row({ state: 'active' })]);
  assert.equal(await runMcpReview({}, 'mu_1', state.dependencies), 0);
  assert.deepEqual(state.logs, ['[aevra] github has no pending catalog change']);
});
test('a disabled reviewable server reviews and accepts like an enabled one', async () => {
  const review = fixture([row({ enabled: false })]);
  assert.equal(await runMcpReview({}, 'mu_1', review.dependencies), 0);
  assert.equal(review.logs[0], '[aevra] github changed its catalog:');
  assert.equal(review.logs.at(-1), 'Run: aevra mcp accept mu_1 --yes');
  const accept = fixture([row({ enabled: false })]);
  assert.equal(await runMcpAccept({}, 'mu_1', true, accept.dependencies), 0);
  const [post] = accept.posts();
  assert.deepEqual(JSON.parse(post?.init.body), {
    expectedFingerprint: 'fingerprint-one-two-three',
  });
  assert.deepEqual(accept.errors, []);
});
test('a disabled blocked server says to enable it first and sends nothing', async () => {
  const blocked = { enabled: false, pendingCatalogDiff: null, pendingCatalogFingerprint: null };
  const hint =
    '[aevra] github is blocked pending review and disabled. Run: aevra mcp enable mu_1, then aevra mcp test mu_1';
  const review = fixture([row(blocked)]);
  assert.equal(await runMcpReview({}, 'mu_1', review.dependencies), 0);
  assert.deepEqual(review.logs, [hint]);
  assert.equal(review.posts().length, 0);
  const accept = fixture([row(blocked)]);
  assert.equal(await runMcpAccept({}, 'mu_1', true, accept.dependencies), 1);
  assert.deepEqual(accept.errors, [hint]);
  assert.equal(accept.posts().length, 0);
});
test('accept of an active server exits 1 without a POST', async () => {
  const state = fixture([row({ state: 'active' })]);
  assert.equal(await runMcpAccept({}, 'mu_1', true, state.dependencies), 1);
  assert.deepEqual(state.errors, ['[aevra] github has no pending catalog change']);
  assert.equal(state.posts().length, 0);
});
test('review of a blocked server prints the hint and exits 0', async () => {
  const state = fixture([row({ pendingCatalogDiff: null, pendingCatalogFingerprint: null })]);
  assert.equal(await runMcpReview({}, 'mu_1', state.dependencies), 0);
  assert.deepEqual(state.logs, [
    '[aevra] github is blocked pending review. Run: aevra mcp test mu_1',
  ]);
});
test('accept of a blocked server exits 1 and sends nothing', async () => {
  const state = fixture([row({ pendingCatalogDiff: null, pendingCatalogFingerprint: null })]);
  assert.equal(await runMcpAccept({}, 'mu_1', true, state.dependencies), 1);
  assert.deepEqual(state.errors, [
    '[aevra] github is blocked pending review. Run: aevra mcp test mu_1',
  ]);
  assert.equal(state.posts().length, 0);
});
test('review of a reviewable server prints the diff and the accept command', async () => {
  const state = fixture([row()]);
  assert.equal(await runMcpReview({}, 'mu_1', state.dependencies), 0);
  assert.deepEqual(state.logs, [
    '[aevra] github changed its catalog:',
    'Added:',
    '  tool search',
    'Removed:',
    '  resource repo:///readme',
    'Fingerprint: fingerprint-',
    'Run: aevra mcp accept mu_1 --yes',
  ]);
  assert.equal(state.posts().length, 0);
});
test('accept without --yes shows the diff, exits 1 and sends nothing', async () => {
  const state = fixture([row()]);
  assert.equal(await runMcpAccept({}, 'mu_1', false, state.dependencies), 1);
  assert.deepEqual(state.logs, [
    '[aevra] github changed its catalog:',
    'Added:',
    '  tool search',
    'Removed:',
    '  resource repo:///readme',
    'Fingerprint: fingerprint-',
  ]);
  assert.deepEqual(state.errors, ['Re-run with --yes to accept']);
  assert.equal(state.posts().length, 0);
});
test('accept with --yes posts the shown fingerprint and exits 0', async () => {
  const state = fixture([row()]);
  assert.equal(await runMcpAccept({}, 'mu_1', true, state.dependencies), 0);
  const [post] = state.posts();
  assert.equal(post?.path, '/api/mcp/upstreams/mu_1/acknowledge');
  assert.equal(post?.init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(post?.init.body), {
    expectedFingerprint: 'fingerprint-one-two-three',
  });
  assert.deepEqual(state.logs, [
    '[aevra] github changed its catalog:',
    'Added:',
    '  tool search',
    'Removed:',
    '  resource repo:///readme',
    'Fingerprint: fingerprint-',
    '[aevra] Accepted catalog for github; its tools are served again',
  ]);
  assert.deepEqual(state.errors, []);
  assert.equal(state.order.indexOf('POST'), state.order.length - 2);
  assert.equal(state.order[0], '[aevra] github changed its catalog:');
});
test('accept reports a catalog that changed again and exits 1', async () => {
  const state = fixture([row()], () =>
    response({ error: { code: 'MCP_UPSTREAM_CATALOG_CHANGED', message: 'changed' } }, false, 409),
  );
  assert.equal(await runMcpAccept({}, 'mu_1', true, state.dependencies), 1);
  assert.deepEqual(state.errors, ['[aevra] The catalog changed again; run aevra mcp review mu_1']);
});
test('accept surfaces other failures through the error path', async () => {
  const state = fixture([row()], () =>
    response(
      { error: { code: 'MCP_UPSTREAM_DISABLED', message: 'server is disabled' } },
      false,
      409,
    ),
  );
  await assert.rejects(runMcpAccept({}, 'mu_1', true, state.dependencies), /server is disabled/);
});
test('a failed list throws its message', async () => {
  const state = fixture([]);
  state.dependencies.api = async () => response({ error: { message: 'denied' } }, false, 403);
  await assert.rejects(runMcpReview({}, 'mu_1', state.dependencies), /denied/);
});
test('a removals-only diff is reviewable', async () => {
  const only = { added: [], removed: ['tool:old'], changed: [] };
  const state = fixture([row({ pendingCatalogDiff: only })]);
  assert.equal(await runMcpAccept({}, 'mu_1', true, state.dependencies), 0);
  assert.equal(state.posts().length, 1);
});
