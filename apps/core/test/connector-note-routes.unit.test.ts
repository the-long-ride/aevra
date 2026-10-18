import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ConnectorNotesRepository } from '../../../packages/store/src/connector-notes.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { handleAdminApi } from '../src/admin/routes/api.js';
import { ConnectorProfileStore } from '../src/usage/connector-profiles.js';
import { ConnectorNotesService } from '../src/usage/connector-notes.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const BASE = '/api/connector-notes/connector%3Aalpha';

function request(method: string, value?: unknown, raw?: Buffer) {
  const text = raw ?? (value === undefined ? undefined : Buffer.from(JSON.stringify(value)));
  const stream = Readable.from(text ? [text] : []) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: Buffer.alloc(0) as Buffer,
    setHeader(name: string, value: string) {
      result.headers[name.toLowerCase()] = value;
    },
    end(value: string | Buffer = '') {
      result.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    },
  };
  return result as any;
}

function fixture() {
  const db = AevraDatabase.open(':memory:');
  const settings = new SettingsRepository(db.raw());
  const auditEvents: any[] = [];
  const context: any = {
    audit: { append: (event: any) => auditEvents.push(event) },
    connectorNotes: new ConnectorNotesService(new ConnectorNotesRepository(db.raw())),
    connectorProfiles: new ConnectorProfileStore(settings),
  };
  async function call(method: string, path: string, body?: unknown, raw?: Buffer) {
    const res = response();
    await handleAdminApi(
      request(method, body, raw),
      res,
      new URL(`https://localhost${path}`),
      context,
    );
    const type = res.headers['content-type'] ?? '';
    return {
      status: res.statusCode,
      headers: res.headers,
      bytes: res.body as Buffer,
      json:
        type === 'application/json' && res.body.length
          ? JSON.parse(res.body.toString())
          : undefined,
    };
  }
  return { db, call, auditEvents };
}

test('GET lists the notes without a connector-level switch', async () => {
  const { db, call } = fixture();
  const empty = await call('GET', BASE);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json, { actor: 'connector:alpha', notes: [] });
  db.close();
});

test('POST creates a note (201) and audits without content', async () => {
  const { db, call, auditEvents } = fixture();
  const created = await call('POST', `${BASE}/notes`, { text: 'plain test phrase' });
  assert.equal(created.status, 201);
  assert.equal(created.json.title, 'note-1');
  assert.equal(created.json.visibleToAi, true);
  assert.equal(created.json.aiCanDelete, false);
  assert.equal(created.json.readOnConnect, false);
  assert.deepEqual(auditEvents.at(-1), {
    actor: 'admin',
    operation: 'connector.note.create',
    target: 'connector:alpha',
    result: 'ok',
    redactionCount: 0,
    class: 'normal',
  });
  assert.equal(JSON.stringify(auditEvents).includes('plain test phrase'), false);
  const listed = await call('GET', BASE);
  assert.equal(listed.json.notes.length, 1);
  db.close();
});

test('PATCH edits and flips switches; DELETE is permanent', async () => {
  const { db, call, auditEvents } = fixture();
  const created = (await call('POST', `${BASE}/notes`, { text: 'a' })).json;
  const patched = await call('PATCH', `${BASE}/notes/${created.id}`, { aiCanDelete: true });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.aiCanDelete, true);
  assert.equal(auditEvents.at(-1).operation, 'connector.note.update');
  const deleted = await call('DELETE', `${BASE}/notes/${created.id}`);
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json, { deleted: true });
  assert.equal(auditEvents.at(-1).operation, 'connector.note.delete');
  const again = await call('DELETE', `${BASE}/notes/${created.id}`);
  assert.equal(again.status, 404);
  assert.equal(again.json.error.code, 'NOTE_NOT_FOUND');
  db.close();
});

test('the settings route is gone; readOnConnect round-trips on note create and PATCH', async () => {
  const { db, call, auditEvents } = fixture();
  const put = await call('PUT', `${BASE}/settings`, { readOnConnect: true });
  assert.equal(put.status, 404);
  assert.equal(put.json.error.code, 'NOT_FOUND');
  assert.equal(auditEvents.length, 0);
  const created = await call('POST', `${BASE}/notes`, { text: 'a', readOnConnect: true });
  assert.equal(created.status, 201);
  assert.equal(created.json.readOnConnect, true);
  const patched = await call('PATCH', `${BASE}/notes/${created.json.id}`, {
    readOnConnect: false,
  });
  assert.equal(patched.json.readOnConnect, false);
  assert.equal((await call('GET', BASE)).json.notes[0].readOnConnect, false);
  const bad = await call('PATCH', `${BASE}/notes/${created.json.id}`, { readOnConnect: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'INVALID_CONNECTOR_NOTE');
  db.close();
});

test('validation errors are 400 INVALID_CONNECTOR_NOTE and unknown notes are 404', async () => {
  const { db, call, auditEvents } = fixture();
  const bad = await call('POST', `${BASE}/notes`, { text: '' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'INVALID_CONNECTOR_NOTE');
  assert.equal(auditEvents.length, 0);
  const missing = await call('PATCH', `${BASE}/notes/nope`, { text: 'x' });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOTE_NOT_FOUND');
  const badActor = await call('GET', '/api/connector-notes/%E0%A4%A');
  assert.equal(badActor.status, 400);
  assert.equal(badActor.json.error.code, 'INVALID_CONNECTOR_NOTE');
  db.close();
});

test('image GET returns raw bytes with safe headers', async () => {
  const { db, call } = fixture();
  const note = (
    await call('POST', `${BASE}/notes`, { addImages: [{ dataBase64: PNG.toString('base64') }] })
  ).json;
  const image = await call('GET', `${BASE}/notes/${note.id}/images/${note.images[0].id}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.equal(image.headers['cache-control'], 'no-store');
  assert.equal(image.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(image.bytes, PNG);
  const missing = await call('GET', `${BASE}/notes/${note.id}/images/nope`);
  assert.equal(missing.status, 404);
  db.close();
});

test('note POST/PATCH accept bodies above 1 MiB; other routes keep the 1 MiB limit', async () => {
  const { db, call } = fixture();
  const big = Buffer.concat([PNG, Buffer.alloc(1_500_000)]).toString('base64');
  const created = await call('POST', `${BASE}/notes`, { addImages: [{ dataBase64: big }] });
  assert.equal(created.status, 201);
  const patched = await call('PATCH', `${BASE}/notes/${created.json.id}`, {
    addImages: [{ dataBase64: big }],
  });
  assert.equal(patched.status, 200);
  const padding = 'x'.repeat(1_200_000);
  const profile = await call('PUT', '/api/connector-profiles/connector%3Aalpha', { padding });
  assert.equal(profile.status, 413);
  const huge = Buffer.alloc(12 * 1024 * 1024 + 10, 0x20);
  const tooBig = await call('POST', `${BASE}/notes`, undefined, huge);
  assert.equal(tooBig.status, 413);
  db.close();
});

test('unsupported methods are 405 and a missing service is 503', async () => {
  const { db, call } = fixture();
  assert.equal((await call('POST', BASE)).status, 405);
  assert.equal((await call('GET', `${BASE}/notes`)).status, 405);
  assert.equal((await call('GET', `${BASE}/settings`)).status, 404);
  assert.equal((await call('POST', `${BASE}/notes/x/images/y`)).status, 405);
  assert.equal((await call('GET', `${BASE}/notes/x/other`)).status, 404);
  const res = response();
  await handleAdminApi(request('GET'), res, new URL(`https://localhost${BASE}`), {});
  assert.equal(res.statusCode, 503);
  db.close();
});
