import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ConnectorRepository } from '../../../packages/store/src/connectors.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AuditService } from '../src/audit/audit-service.js';
import { AdminBootstrapService } from '../src/admin/bootstrap.js';
import { AdminServer } from '../src/admin/server.js';
async function login(server: AdminServer, secret: string) {
  const r = await fetch(`${server.url()}/api/local/bootstrap`, {
    method: 'POST',
    headers: { 'x-aevra-control': secret },
  });
  const { token } = (await r.json()) as any;
  const auth = await fetch(`${server.url()}/auth/bootstrap?token=${token}`, { redirect: 'manual' });
  return (auth.headers.get('set-cookie') ?? '').split(';')[0]!;
}
test('connector create and revoke emit hash-chained audit events', async () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const bootstrap = new AdminBootstrapService(raw);
  const audit = new AuditService(new AuditRepository(raw));
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    controlSecret: 'secret',
    api: { connectors: new ConnectorRepository(raw), audit },
  });
  await server.start();
  const cookie = await login(server, 'secret');
  const created = (await (
    await fetch(`${server.url()}/api/connectors`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Audited' }),
    })
  ).json()) as any;
  await fetch(`${server.url()}/api/connectors/${created.id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  const events = JSON.parse(audit.exportJson()) as any[];
  const ops = events.map((e) => e.event.operation);
  assert.ok(ops.includes('connector.create'), 'create audited');
  assert.ok(ops.includes('connector.revoke'), 'revoke audited');
  const create = events.find((e) => e.event.operation === 'connector.create')!;
  assert.equal(create.event.target, 'Audited');
  assert.equal(create.event.class, 'security');
  assert.deepEqual(audit.verify(), { valid: true });
  await server.close();
  db.close();
});
test('connector create/list/revoke over admin API; token shown once', async () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const bootstrap = new AdminBootstrapService(raw);
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    controlSecret: 'secret',
    api: { connectors: new ConnectorRepository(raw) },
  });
  await server.start();
  const cookie = await login(server, 'secret');
  let r = await fetch(`${server.url()}/api/connectors`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Claude.ai' }),
  });
  assert.equal(r.status, 201);
  const created = (await r.json()) as any;
  assert.equal(created.name, 'Claude.ai');
  assert.ok(created.token);
  r = await fetch(`${server.url()}/api/connectors`, { headers: { cookie } });
  const listed = (await r.json()) as any[];
  assert.equal(listed.length, 1);
  assert.equal('token' in listed[0]!, false);
  r = await fetch(`${server.url()}/api/connectors/${created.id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(((await r.json()) as any).ok, true);
  r = await fetch(`${server.url()}/api/connectors`, { headers: { cookie } });
  assert.equal(((await r.json()) as any[]).length, 0);
  await server.close();
  db.close();
});
test('duplicate connector name returns 409 CONNECTOR_EXISTS', async () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const bootstrap = new AdminBootstrapService(raw);
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    controlSecret: 'secret',
    api: { connectors: new ConnectorRepository(raw) },
  });
  await server.start();
  const cookie = await login(server, 'secret');
  const body = JSON.stringify({ name: 'Claude.ai' });
  const first = await fetch(`${server.url()}/api/connectors`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body,
  });
  assert.equal(first.status, 201);
  const second = await fetch(`${server.url()}/api/connectors`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body,
  });
  assert.equal(second.status, 409);
  assert.equal(((await second.json()) as any).error.code, 'CONNECTOR_EXISTS');
  await server.close();
  db.close();
});
test('empty name is rejected', async () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const bootstrap = new AdminBootstrapService(raw);
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    controlSecret: 'secret',
    api: { connectors: new ConnectorRepository(raw) },
  });
  await server.start();
  const cookie = await login(server, 'secret');
  const r = await fetch(`${server.url()}/api/connectors`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: '  ' }),
  });
  assert.equal(r.status, 400);
  await server.close();
  db.close();
});
