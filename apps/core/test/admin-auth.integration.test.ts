import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { AdminBootstrapService } from '../src/admin/bootstrap.js';
import { AdminServer } from '../src/admin/server.js';
test('bootstrap token is control-authenticated single-use', async () => {
  const db = AevraDatabase.open(':memory:');
  const b = new AdminBootstrapService(db.raw());
  const s = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap: b,
    controlSecret: 'secret',
  });
  await s.start();
  let r = await fetch(`${s.url()}/api/local/bootstrap`, { method: 'POST' });
  assert.equal(r.status, 401);
  r = await fetch(`${s.url()}/api/local/bootstrap`, {
    method: 'POST',
    headers: { 'x-aevra-control': 'secret' },
  });
  const { token } = (await r.json()) as any;
  r = await fetch(`${s.url()}/auth/bootstrap?token=${token}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('set-cookie') ?? '', /HttpOnly/);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  assert.equal(
    (await fetch(`${s.url()}/auth/bootstrap?token=${token}`, { redirect: 'manual' })).status,
    401,
  );
  assert.equal((await fetch(`${s.url()}/api/status`, { headers: { cookie } })).status, 200);
  await s.close();
  db.close();
});
