import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAdminApi } from '../src/admin/routes/api.js';

function request(method: string, value?: unknown) {
  const text = value === undefined ? '' : JSON.stringify(value);
  const stream = Readable.from(text ? [Buffer.from(text)] : []) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

function fixture(initial: unknown = { names: [] }) {
  let stored: unknown = initial;
  const audits: any[] = [];
  const catalog = (tools: string[]) => ({
    tools: tools.map((name) => ({ name, description: `${name} does things` })),
    resources: [],
    prompts: [],
  });
  const context = {
    audit: { append: (e: any) => audits.push(e) },
    settings: {
      get: (_k: string, fallback: unknown) => stored ?? fallback,
      set: (_k: string, v: unknown) => {
        stored = v;
      },
    },
    mcpUpstreams: {
      list: () => [
        { id: 'u1', name: 'blender', enabled: true, state: 'active', catalog: catalog(['look']) },
        { id: 'u2', name: 'offline', enabled: true, state: 'degraded', catalog: catalog(['ping']) },
        { id: 'u3', name: 'nocat', enabled: true, state: 'active', catalog: null },
      ],
    },
  };
  async function call(method: string, body?: unknown) {
    const res = response();
    await handleAdminApi(
      request(method, body),
      res,
      new URL('https://localhost/api/tool-switches'),
      context as any,
    );
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : undefined };
  }
  return { call, audits, stored: () => stored };
}

test('GET lists built-in and upstream tools, offline upstream as unavailable', async () => {
  const { call } = fixture({ names: ['git_status', 'blender__look'] });
  const { status, json } = await call('GET');
  assert.equal(status, 200);
  const byName = new Map<string, any>(json.tools.map((t: any) => [t.name, t]));
  assert.deepEqual(
    { ...byName.get('git_status'), description: undefined },
    {
      name: 'git_status',
      source: 'aevra',
      group: 'git',
      locked: false,
      enabled: false,
      available: true,
      description: undefined,
    },
  );
  assert.equal(typeof byName.get('git_status').description, 'string');
  assert.equal(byName.get('aevra_status').locked, true);
  assert.equal(byName.get('aevra_status').enabled, true);
  const look = byName.get('blender__look');
  assert.equal(look.source, 'blender');
  assert.equal(look.group, 'upstream');
  assert.equal(look.enabled, false);
  assert.equal(look.available, true);
  assert.match(look.description, /look does things/);
  const ping = byName.get('offline__ping');
  assert.equal(ping.available, false);
  assert.equal(ping.enabled, true);
});

test('PUT stores a sorted unique list, audits, and returns the listing', async () => {
  const { call, audits, stored } = fixture();
  const { status, json } = await call('PUT', {
    disabled: ['git_status', 'blender__look', 'git_status'],
  });
  assert.equal(status, 200);
  assert.deepEqual(stored(), { names: ['blender__look', 'git_status'] });
  assert.equal(audits[0].operation, 'tools.switches.update');
  assert.equal(json.tools.find((t: any) => t.name === 'git_status').enabled, false);
});

test('PUT with a locked tool is 400 TOOL_LOCKED and stores nothing', async () => {
  const { call, stored } = fixture();
  const { status, json } = await call('PUT', { disabled: ['workspace_select'] });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'TOOL_LOCKED');
  assert.deepEqual(stored(), { names: [] });
});

test('PUT with an unknown tool is 400 UNKNOWN_TOOL before the locked check', async () => {
  const { call, stored } = fixture();
  const unknown = await call('PUT', { disabled: ['no_such_tool', 'workspace_select'] });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error.code, 'UNKNOWN_TOOL');
  assert.match(unknown.json.error.message, /no_such_tool/);
  assert.deepEqual(stored(), { names: [] });
  assert.equal((await call('PUT', { disabled: ['blender__look'] })).status, 200);
});

test('PUT with a malformed body is 400 and other methods are 405', async () => {
  const { call } = fixture();
  assert.equal((await call('PUT', { disabled: 'x' })).status, 400);
  assert.equal((await call('PUT', { disabled: [1] })).status, 400);
  assert.equal((await call('DELETE')).status, 405);
});
