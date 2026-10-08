import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAdminApi } from '../src/admin/routes/api.js';
import { ConnectorProfileStore } from '../src/usage/connector-profiles.js';

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

function fixture(initial: Record<string, unknown> = {}) {
  let stored: unknown = initial;
  const auditEvents: any[] = [];
  const context = {
    connectors: { list: () => [{ name: 'alpha' }] },
    oauth: { listClients: () => [{ clientId: 'c1', clientName: 'Beta', actor: 'oauth:Beta' }] },
    connections: { list: () => [{ actor: 'client:c9' }] },
    audit: { append: (event: any) => auditEvents.push(event) },
    connectorProfiles: new ConnectorProfileStore({
      get: <T>(_key: string, fallback: T) => (stored ?? fallback) as T,
      set: (_key: string, value: unknown) => {
        stored = value;
      },
    }),
  };
  async function call(method: string, path: string, body?: unknown) {
    const res = response();
    await handleAdminApi(request(method, body), res, new URL(`https://localhost${path}`), context);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : undefined };
  }
  return { call, auditEvents };
}

test('GET lists known actors with their saved profile, the groups and group token estimates', async () => {
  const { call } = fixture({ 'connector:alpha': { toolGroups: ['files'] } });
  const { status, json } = await call('GET', '/api/connector-profiles');
  assert.equal(status, 200);
  assert.deepEqual(json.groups, [
    'files',
    'commands',
    'git',
    'changes',
    'skills',
    'browser',
    'desktop',
    'control',
    'upstream',
  ]);
  assert.ok(json.groupTokens.core > 0 && json.groupTokens.browser > json.groupTokens.git);
  const alpha = json.entries.find((e: any) => e.actor === 'connector:alpha');
  assert.deepEqual(alpha, {
    actor: 'connector:alpha',
    label: 'alpha',
    kind: 'connector',
    profile: { toolGroups: ['files'] },
  });
  const beta = json.entries.find((e: any) => e.actor === 'oauth:Beta');
  assert.deepEqual(beta.profile, {});
  assert.equal(json.entries.find((e: any) => e.actor === 'client:c9').kind, 'client');
});

test('a stored profile for an actor that is no longer listed still appears', async () => {
  const { call } = fixture({ 'connector:gone': { resultFormat: 'text' } });
  const { json } = await call('GET', '/api/connector-profiles');
  assert.equal(json.entries.find((e: any) => e.actor === 'connector:gone').kind, 'connector');
  assert.equal(json.entries.find((e: any) => e.actor === 'connector:gone').label, 'gone');
});

test('an actor without a known prefix is listed as other', async () => {
  const { call } = fixture({ 'weird-actor': { resultFormat: 'text' } });
  const { json } = await call('GET', '/api/connector-profiles');
  assert.equal(json.entries.find((e: any) => e.actor === 'weird-actor').kind, 'other');
});

test('PUT saves a normalised profile, audits it and decodes the actor', async () => {
  const { call, auditEvents } = fixture();
  const { status, json } = await call('PUT', '/api/connector-profiles/oauth%3ABeta', {
    toolGroups: ['git', 'files'],
    resultFormat: 'text',
  });
  assert.equal(status, 200);
  assert.deepEqual(json, {
    actor: 'oauth:Beta',
    profile: { toolGroups: ['files', 'git'], resultFormat: 'text' },
  });
  assert.deepEqual(auditEvents.at(-1), {
    actor: 'admin',
    operation: 'connector.profile.update',
    target: 'oauth:Beta',
    result: 'ok',
    redactionCount: 0,
    class: 'normal',
  });
  const listed = await call('GET', '/api/connector-profiles');
  assert.deepEqual(listed.json.entries.find((e: any) => e.actor === 'oauth:Beta').profile, {
    toolGroups: ['files', 'git'],
    resultFormat: 'text',
  });
});

test('PUT with an invalid profile is a 400 and is not stored or audited', async () => {
  const { call, auditEvents } = fixture();
  const { status, json } = await call('PUT', '/api/connector-profiles/oauth%3ABeta', {
    toolGroups: ['nope'],
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'INVALID_CONNECTOR_PROFILE');
  assert.equal(auditEvents.length, 0);
});

test('malformed percent-encoding is a 400', async () => {
  const { call } = fixture();
  assert.equal((await call('PUT', '/api/connector-profiles/%E0%A4%A', {})).status, 400);
});

test('other methods are 405', async () => {
  const { call } = fixture();
  assert.equal((await call('DELETE', '/api/connector-profiles/oauth%3ABeta')).status, 405);
  assert.equal((await call('POST', '/api/connector-profiles')).status, 405);
});

test('a context without a profile store answers 503', async () => {
  const res = response();
  await handleAdminApi(
    request('GET'),
    res,
    new URL('https://localhost/api/connector-profiles'),
    {},
  );
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error.code, 'PROFILES_UNAVAILABLE');
});
