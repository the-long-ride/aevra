import assert from 'node:assert/strict';
import test from 'node:test';
import { McpToolService } from '../../../packages/mcp-tools/src/service.js';
import { handleJsonRpc } from '../../../packages/mcp-tools/src/register.js';
import {
  callUpstreamTool,
  getUpstreamPrompt,
  readUpstreamResource,
} from '../../../packages/mcp-tools/src/upstream-proxy.js';
import type { UpstreamCatalog } from '../../../packages/mcp-upstream/src/protocol.js';
import type { McpUpstreamCall } from '../../../packages/protocol/src/mcp-upstream.js';
import type { SecretStore } from '../../../packages/secrets/src/store.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { UpstreamRegistryService } from '../src/mcp-upstream/upstream-registry-service.js';
import { UpstreamRepository } from '../src/mcp-upstream/upstream-repository.js';

const SECRET_REF = 'sr_toggle';

function catalogFor(server: string): UpstreamCatalog {
  return {
    tools: [{ name: 'search', description: `${server} search`, inputSchema: { type: 'object' } }],
    resources: [{ uri: 'repo://readme', name: `${server} readme` }],
    prompts: [{ name: 'triage', description: `${server} triage` }],
  };
}

function harness() {
  const db = AevraDatabase.open(':memory:');
  const connected = new Set<string>();
  const connects: string[] = [];
  const disconnects: string[] = [];
  const forwarded: Array<{ upstreamId: string; call: McpUpstreamCall }> = [];
  let secretWrites = 0;
  const catalogs = new Map<string, UpstreamCatalog>();
  const secrets: SecretStore = {
    set: async () => {
      secretWrites += 1;
    },
    get: async (ref) => (ref === SECRET_REF ? 'placeholder-credential' : null),
    delete: async () => {
      secretWrites += 1;
    },
  };
  const registry = new UpstreamRegistryService({
    repository: new UpstreamRepository(db.raw()),
    secrets,
    worker: {
      connect: async (upstreamId, config) => {
        connects.push(upstreamId);
        connected.add(upstreamId);
        const url = new URL((config as { url: string }).url);
        catalogs.set(upstreamId, catalogFor(url.hostname.split('.')[0]!));
      },
      catalog: async (upstreamId) => catalogs.get(upstreamId)!,
      disconnect: async (upstreamId) => {
        disconnects.push(upstreamId);
        connected.delete(upstreamId);
      },
      status: async (upstreamId) => ({
        upstreamId,
        state: connected.has(upstreamId) ? 'connected' : 'idle',
        server: null,
        failures: 0,
        retryAfter: null,
        lastError: null,
        listChangedAt: null,
      }),
      call: async (upstreamId, call) => {
        forwarded.push({ upstreamId, call });
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    },
    now: () => new Date('2026-09-15T00:00:00.000Z'),
  });
  const service = new McpToolService(
    {
      get: () => ({ id: 's1', actor: 'oauth:Client', subject: 'subject' }),
      touch() {},
      activeLease: () => ({ workspaceId: 'w1', capabilities: ['mcp.proxy'] }),
      isYolo: () => false,
    } as any,
    {
      capabilityRoots: () => [],
      listRemote: () => [],
      getLocal: () => ({ id: 'w1', hostRoot: 'F:/workspace', name: 'workspace', description: '' }),
    } as any,
    { execute: async () => ({ ok: true, value: {} }) } as any,
    { put() {} } as any,
    { request: async () => ({ status: 'approval_pending' as const, requestId: 'r1' }) } as any,
    {
      audit: { append() {} } as any,
      skills: {
        list: () => [],
        read: () => null,
        instructions: () => ({ instructions: [] }),
      } as any,
      upstreams: registry as any,
    },
  );
  async function register(name: string, auth: Record<string, string> = {}) {
    return registry.register({
      name,
      transport: 'http',
      config: { url: `https://${name}.test/mcp` },
      auth,
      risk: 'MEDIUM',
    });
  }
  const context = () => (service as any).context();
  const rpc = async (method: string): Promise<any> =>
    (await handleJsonRpc(service, 's1', { jsonrpc: '2.0', id: 1, method })).result;
  const listed = async () => ({
    tools: (await rpc('tools/list')).tools.map((tool: any) => tool.name as string),
    resources: (await rpc('resources/list')).resources.map((r: any) => r.uri as string),
    prompts: (await rpc('prompts/list')).prompts.map((p: any) => p.name as string),
  });
  return {
    db,
    registry,
    service,
    connects,
    disconnects,
    forwarded,
    connected,
    secretWrites: () => secretWrites,
    register,
    context,
    listed,
  };
}

async function twoServers() {
  const state = harness();
  const alpha = await state.register('alpha');
  const beta = await state.register('beta');
  return { ...state, alpha, beta };
}

const refused = (error: any) => error.code === 'CAPABILITY_REQUIRED';

test('tools, resources and prompts of a disabled server vanish and return on enable', async () => {
  const { db, registry, alpha, listed } = await twoServers();
  try {
    const before = await listed();
    assert.ok(before.tools.includes('alpha__search') && before.tools.includes('beta__search'));
    assert.ok(before.resources.includes('mcp+alpha://repo://readme'));
    assert.ok(before.prompts.includes('alpha__triage'));

    await registry.setEnabled(alpha.id, false);
    const off = await listed();
    assert.ok(!off.tools.some((name: string) => name.startsWith('alpha__')));
    assert.ok(!off.resources.some((uri: string) => uri.startsWith('mcp+alpha://')));
    assert.ok(!off.prompts.some((name: string) => name.startsWith('alpha__')));
    assert.deepEqual(
      [off.tools.includes('beta__search'), off.prompts.includes('beta__triage')],
      [true, true],
    );
    assert.ok(off.resources.includes('mcp+beta://repo://readme'));

    await registry.setEnabled(alpha.id, true);
    assert.deepEqual(await listed(), before);
  } finally {
    db.close();
  }
});

test('calls, reads and prompt gets on a disabled server fail and never reach its worker', async () => {
  const { db, registry, alpha, context, forwarded, connects } = await twoServers();
  try {
    await registry.setEnabled(alpha.id, false);
    const connectsBefore = connects.length;
    await assert.rejects(callUpstreamTool(context(), 's1', 'alpha__search', {}), refused);
    await assert.rejects(
      readUpstreamResource(context(), 's1', 'mcp+alpha://repo://readme'),
      refused,
    );
    await assert.rejects(getUpstreamPrompt(context(), 's1', 'alpha__triage', {}), refused);
    assert.equal(forwarded.filter((entry) => entry.upstreamId === alpha.id).length, 0);
    assert.equal(connects.length, connectsBefore, 'a disabled server was reconnected');
  } finally {
    db.close();
  }
});

test('the other server stays connected, listed and callable after a toggle', async () => {
  const { db, registry, alpha, beta, context, forwarded, connected, disconnects, listed } =
    await twoServers();
  try {
    await registry.setEnabled(alpha.id, false);
    assert.deepEqual(disconnects, [alpha.id], 'only the toggled server was disconnected');
    assert.ok(!connected.has(alpha.id));
    assert.ok(connected.has(beta.id), 'the other server lost its session');
    assert.ok((await listed()).tools.includes('beta__search'));

    const result: any = await callUpstreamTool(context(), 's1', 'beta__search', { q: 'x' });
    assert.equal(result.untrusted, true);
    assert.deepEqual(
      forwarded.map((entry) => entry.upstreamId),
      [beta.id],
    );

    await registry.setEnabled(alpha.id, true);
    assert.ok(connected.has(beta.id));
    assert.deepEqual(disconnects, [alpha.id]);
  } finally {
    db.close();
  }
});

test('a re-enabled server reconnects on its first call', async () => {
  const { db, registry, alpha, context, forwarded, connects } = await twoServers();
  try {
    await registry.setEnabled(alpha.id, false);
    const connectsBefore = connects.length;
    await registry.setEnabled(alpha.id, true);
    assert.equal(connects.length, connectsBefore, 'enabling must not connect eagerly');
    await callUpstreamTool(context(), 's1', 'alpha__search', {});
    assert.equal(connects.at(-1), alpha.id);
    assert.deepEqual(
      forwarded.map((entry) => entry.upstreamId),
      [alpha.id],
    );
  } finally {
    db.close();
  }
});

test('a needs-review server stays absent and refused after enable', async () => {
  const { db, registry, alpha, beta, context, forwarded, connects, listed } = await twoServers();
  try {
    registry.markNeedsReview(alpha.id);
    await registry.setEnabled(alpha.id, false);
    const connectsBefore = connects.length;
    await registry.setEnabled(alpha.id, true);
    assert.equal(registry.get(alpha.id)?.state, 'needs-review');
    const visible = await listed();
    assert.ok(!visible.tools.some((name: string) => name.startsWith('alpha__')));
    assert.ok(visible.tools.includes('beta__search'));
    await assert.rejects(callUpstreamTool(context(), 's1', 'alpha__search', {}), refused);
    await assert.rejects(
      readUpstreamResource(context(), 's1', 'mcp+alpha://repo://readme'),
      refused,
    );
    assert.equal(connects.length, connectsBefore);
    assert.deepEqual(forwarded, []);
    assert.equal(registry.get(beta.id)?.enabled, true);
  } finally {
    db.close();
  }
});

function snapshot(db: AevraDatabase): Record<string, unknown[]> {
  const raw = db.raw();
  const names = (
    raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
      name: string;
    }>
  )
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_') && name !== 'mcp_upstreams');
  return Object.fromEntries(
    names.map((name) => [name, raw.prepare(`SELECT * FROM "${name}"`).all() as unknown[]]),
  );
}

test('toggling writes no connection, session, token or grant rows and keeps stored auth', async () => {
  const state = harness();
  try {
    const alpha = await state.register('alpha', {
      header: 'Authorization',
      secretRefId: SECRET_REF,
    });
    await state.register('beta');
    const raw = state.db.raw();
    raw
      .prepare(
        'INSERT INTO sessions(id,actor,subject,created_at,last_activity_at) VALUES(?,?,?,?,?)',
      )
      .run('s1', 'oauth:Client', 'subject', '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z');
    const authJson = () =>
      (raw.prepare('SELECT auth_json authJson FROM mcp_upstreams WHERE id=?').get(alpha.id) as any)
        .authJson;
    const tablesBefore = snapshot(state.db);
    const authBefore = authJson();
    const writesBefore = state.secretWrites();
    assert.ok(Object.keys(tablesBefore).includes('sessions'));
    assert.ok(tablesBefore.sessions!.length === 1);

    await state.registry.setEnabled(alpha.id, false);
    await state.registry.setEnabled(alpha.id, false);
    await state.registry.setEnabled(alpha.id, true);

    assert.deepEqual(snapshot(state.db), tablesBefore);
    assert.equal(authJson(), authBefore);
    assert.deepEqual(state.registry.get(alpha.id)?.auth, {
      header: 'Authorization',
      secretRefId: SECRET_REF,
    });
    assert.equal(state.secretWrites(), writesBefore, 'toggling touched the secret store');
  } finally {
    state.db.close();
  }
});
