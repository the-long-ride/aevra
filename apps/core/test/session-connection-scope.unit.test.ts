import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectionHasMultipleSessions,
  grantSourceFor,
} from '../src/sessions/session-connection-scope.js';
import type { SecuritySession } from '../src/sessions/session-types.js';

test('rotation hint stays off for a single reconnect and fires only on >= 3 sessions', () => {
  const now = 1_000_000;
  const sessions = new Map<string, SecuritySession>();
  const disconnected = new Map<
    string,
    { actor: string; subject: string; connectionId?: string; disconnectedAt?: string }
  >();
  const scope = {
    sessions,
    disconnected,
    yolo: new Set<string>(),
  };

  const ticket = {
    actor: 'oauth:chatgpt',
    connectionId: 'conn_1',
    sessionId: 'sess_2',
  };

  // 1 active session only -> false
  sessions.set('sess_1', {
    id: 'sess_1',
    actor: 'oauth:chatgpt',
    subject: 'sub_1',
    connectionId: 'conn_1',
    createdAt: new Date(now - 10_000).toISOString(),
    lastActivityAt: new Date(now - 5_000).toISOString(),
  });
  assert.equal(connectionHasMultipleSessions(scope, ticket, now), false);

  // Single reconnect: sess_1 disconnected, sess_2 active -> total 2 sessions -> false
  sessions.delete('sess_1');
  disconnected.set('sess_1', {
    actor: 'oauth:chatgpt',
    subject: 'sub_1',
    connectionId: 'conn_1',
    disconnectedAt: new Date(now - 5_000).toISOString(),
  });
  sessions.set('sess_2', {
    id: 'sess_2',
    actor: 'oauth:chatgpt',
    subject: 'sub_1',
    connectionId: 'conn_1',
    createdAt: new Date(now - 2_000).toISOString(),
    lastActivityAt: new Date(now - 1_000).toISOString(),
  });
  assert.equal(connectionHasMultipleSessions(scope, ticket, now), false);

  // Second reconnect (rotating client): sess_1 and sess_2 disconnected, sess_3 active -> total 3 sessions -> true
  sessions.delete('sess_2');
  disconnected.set('sess_2', {
    actor: 'oauth:chatgpt',
    subject: 'sub_1',
    connectionId: 'conn_1',
    disconnectedAt: new Date(now - 1_000).toISOString(),
  });
  sessions.set('sess_3', {
    id: 'sess_3',
    actor: 'oauth:chatgpt',
    subject: 'sub_1',
    connectionId: 'conn_1',
    createdAt: new Date(now).toISOString(),
    lastActivityAt: new Date(now).toISOString(),
  });
  const ticket3 = { ...ticket, sessionId: 'sess_3' };
  assert.equal(connectionHasMultipleSessions(scope, ticket3, now), true);

  // Expired sessions outside windowMs (15 min = 900_000 ms) do not count
  disconnected.set('sess_1', {
    actor: 'oauth:chatgpt',
    subject: 'sub_1',
    connectionId: 'conn_1',
    disconnectedAt: new Date(now - 1_000_000).toISOString(),
  });
  assert.equal(connectionHasMultipleSessions(scope, ticket3, now), false);

  // Non-oauth actor returns false
  assert.equal(
    connectionHasMultipleSessions(scope, { ...ticket3, actor: 'connector:slack' }, now),
    false,
  );
});

test('grant source falls back to the frozen ticket identity once its session is gone', () => {
  const scope = {
    sessions: new Map<string, SecuritySession>(),
    disconnected: new Map(),
    yolo: new Set<string>(),
  };
  const ticket = {
    actor: 'oauth:gemini',
    sessionId: 'gone',
    connectionId: 'conn_1',
    connectionSubject: 'sub_1',
  };
  assert.deepEqual(grantSourceFor(scope, ticket), { actor: 'oauth:gemini', subject: 'sub_1' });
  assert.throws(() => grantSourceFor(scope, 'gone'), /session identity not found/);
  assert.throws(
    () => grantSourceFor(scope, { ...ticket, connectionSubject: undefined }),
    /session identity not found/,
  );
  const revoked = {
    ...scope,
    connections: { state: () => ({ status: 'REVOKED' }) } as any,
  };
  assert.throws(() => grantSourceFor(revoked, ticket), /connection revoked/);
});
