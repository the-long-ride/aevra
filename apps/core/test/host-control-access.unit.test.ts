import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { HostControlGrantRepository } from '../../../packages/store/src/host-control-grants.js';
import { HostControlAccess } from '../src/control/host-control-access.js';

test('same OAuth actor has no shared host control and a revoked connection loses access', () => {
  const db = AevraDatabase.open(':memory:');
  const identities = new Map([
    [
      's1',
      { connectionKind: 'oauth', actor: 'oauth:ChatGPT', subject: 'one', connectionId: 'one' },
    ],
    [
      's2',
      { connectionKind: 'oauth', actor: 'oauth:ChatGPT', subject: 'two', connectionId: 'two' },
    ],
  ]);
  const states = new Map([
    ['one', { status: 'CONNECTED' }],
    ['two', { status: 'CONNECTED' }],
  ]);
  const access = new HostControlAccess(
    {
      connectionIdentity: (id: string) => identities.get(id) ?? null,
      connectionState: (id: string) => states.get(id) ?? null,
    } as any,
    new HostControlGrantRepository(db.raw()),
  );
  access.grant(access.identity('s1')!, 'browser.control', 'admin');
  assert.equal(access.has('s1', 'browser.control'), true);
  assert.equal(access.has('s2', 'browser.control'), false);
  assert.equal(access.has('s1', 'desktop.control'), false);
  states.set('one', { status: 'REVOKED' });
  assert.equal(access.has('s1', 'browser.control'), false);
  assert.equal(access.has('missing', 'browser.control'), false);
  db.close();
});

test('connector key is stable while ordinary session grants remain private', () => {
  const db = AevraDatabase.open(':memory:');
  const identity = new Map([
    [
      'connector-session',
      { connectionKind: 'connector', actor: 'connector:Example', subject: 'connector-id' },
    ],
    ['plain-session', { connectionKind: 'session', actor: 'local', subject: 'same-subject' }],
    ['other-session', { connectionKind: 'session', actor: 'local', subject: 'same-subject' }],
  ]);
  const access = new HostControlAccess(
    {
      connectionIdentity: (id: string) => identity.get(id) ?? null,
      connectionState: () => null,
    } as any,
    new HostControlGrantRepository(db.raw()),
  );
  assert.deepEqual(access.identity('connector-session'), {
    kind: 'connector',
    key: 'connector-id',
  });
  access.grant(access.identity('connector-session')!, 'desktop.control', 'admin');
  access.grant(access.identity('plain-session')!, 'browser.control', 'admin');
  assert.equal(access.has('connector-session', 'desktop.control'), true);
  assert.equal(access.has('other-session', 'browser.control'), false);
  db.close();
});

test('a removed connector loses its host grant even if its session identity remains', () => {
  const db = AevraDatabase.open(':memory:');
  let active = true;
  const access = new HostControlAccess(
    {
      connectionIdentity: () => ({
        connectionKind: 'connector',
        actor: 'connector:Example',
        subject: 'con-one',
      }),
      connectionState: () => null,
    } as any,
    new HostControlGrantRepository(db.raw()),
    () => active,
  );
  access.grant({ kind: 'connector', key: 'con-one' }, 'browser.control', 'admin');
  assert.equal(access.has('s1', 'browser.control'), true);
  active = false;
  assert.equal(access.has('s1', 'browser.control'), false);
  db.close();
});

test('uses the normalized connection kind instead of parsing the actor label', () => {
  const db = AevraDatabase.open(':memory:');
  const access = new HostControlAccess(
    {
      connectionIdentity: () => ({
        connectionKind: 'oauth',
        actor: 'renamed-provider',
        subject: 'one',
        connectionId: 'one',
      }),
      connectionState: () => ({ status: 'CONNECTED' }),
    } as any,
    new HostControlGrantRepository(db.raw()),
  );

  assert.deepEqual(access.identity('s1'), { kind: 'oauth', key: 'one' });
  db.close();
});

test('notifies revocation listeners with the exact identity and capability', async () => {
  const db = AevraDatabase.open(':memory:');
  const access = new HostControlAccess(
    {
      connectionIdentity: () => ({
        connectionKind: 'oauth',
        actor: 'oauth:ChatGPT',
        subject: 'one',
        connectionId: 'one',
      }),
      connectionState: () => ({ status: 'CONNECTED' }),
    } as any,
    new HostControlGrantRepository(db.raw()),
  );
  const observed: unknown[] = [];
  (access as any).setRevocationHandler(async (identity: unknown, capability: unknown) => {
    observed.push({ identity, capability });
  });
  access.grant({ kind: 'oauth', key: 'one' }, 'desktop.control', 'admin');

  assert.equal(await access.revoke({ kind: 'oauth', key: 'one' }, 'desktop.control'), true);
  assert.deepEqual(observed, [
    { identity: { kind: 'oauth', key: 'one' }, capability: 'desktop.control' },
  ]);
  db.close();
});
