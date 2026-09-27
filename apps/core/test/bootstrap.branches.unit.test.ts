import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { AdminBootstrapService, ensureLocalControlSecret, secretEquals } from '../src/admin/bootstrap.js';

function open(ttlMs?: number, sessionTtlMs?: number) {
  const db = AevraDatabase.open(':memory:');
  return { db, service: new AdminBootstrapService(db.raw(), ttlMs, sessionTtlMs) };
}

test('bootstrap tokens are single use and expire', async () => {
  const { db, service } = open();
  const { token } = await service.issue();
  const first = await service.consume(token);
  assert.ok(first?.sessionId);
  assert.equal(service.validateSession(first!.sessionId), true);
  assert.equal(await service.consume(token), null);
  assert.equal(await service.consume('unknown'), null);
  db.close();
  const expired = open(-1000);
  const stale = await expired.service.issue();
  assert.equal(await expired.service.consume(stale.token), null);
  expired.db.close();
});

test('sessions validate, expire and can be revoked individually or by hash', async () => {
  const { db, service } = open();
  assert.equal(service.validateSession(undefined), false);
  assert.equal(service.validateSession('nope'), false);
  assert.deepEqual(service.revokeSession(undefined), { revoked: false });
  const a = await service.issueSession();
  const b = await service.issueSession();
  assert.deepEqual(service.revokeSession(a.sessionId), { revoked: true });
  assert.deepEqual(service.revokeSession(a.sessionId), { revoked: false });
  const rows = service.listSessions() as any[];
  assert.equal(rows.length, 1);
  service.revokeSessionHash(rows[0].idHash);
  assert.equal(service.validateSession(b.sessionId), false);
  db.close();
  const short = open(60_000, -1000);
  const old = await short.service.issueSession();
  assert.equal(short.service.validateSession(old.sessionId), false);
  short.db.close();
});

test('revokeAllExcept keeps only the named session, or none without one', async () => {
  const { db, service } = open();
  const keep = await service.issueSession();
  await service.issueSession();
  await service.issueSession();
  assert.deepEqual(service.revokeAllExcept(keep.sessionId), { revoked: 2, preserved: 1 });
  assert.deepEqual(service.revokeAllExcept('not-a-session'), { revoked: 1, preserved: 0 });
  await service.issueSession();
  assert.deepEqual(service.revokeAllExcept(undefined), { revoked: 1, preserved: 0 });
  await service.issueSession();
  await service.revokeAll();
  assert.equal((service.listSessions() as any[]).length, 0);
  db.close();
});

test('local control secret is created once and reused', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aevra-bootstrap-'));
  try {
    const first = ensureLocalControlSecret(dir);
    assert.ok(first.length >= 32);
    assert.equal(ensureLocalControlSecret(dir), first);
    writeFileSync(path.join(dir, 'local-control.secret'), '  sample value \n');
    assert.equal(ensureLocalControlSecret(dir), 'sample value');
    assert.equal(readFileSync(path.join(dir, 'local-control.secret'), 'utf8'), '  sample value \n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('secretEquals rejects missing and differently sized values', () => {
  assert.equal(secretEquals(undefined, 'abc'), false);
  assert.equal(secretEquals('', 'abc'), false);
  assert.equal(secretEquals('ab', 'abc'), false);
  assert.equal(secretEquals('abd', 'abc'), false);
  assert.equal(secretEquals('abc', 'abc'), true);
});
