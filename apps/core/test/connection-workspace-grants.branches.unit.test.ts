import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectionWorkspaceGrantService } from '../src/sessions/connection-workspace-grants.js';

function harness(options: {
  connection?: { status: string; actor: string } | null;
  workspace?: unknown;
  profile?: { capabilities: string[] } | null;
  sessions?: any[];
  leases?: Record<string, any>;
  matchingLeases?: any[] | null;
  forget?: boolean;
  failRepo?: boolean;
  now?: () => Date;
  idleMs?: number;
  withAcross?: boolean;
} = {}) {
  const log: string[] = [];
  const applied: any[] = [];
  const sessions: any = {
    matchingSessions: () => options.sessions ?? [],
    applyLease: (lease: any) => applied.push(lease),
    revokeLease: (id: string) => log.push(`mem-revoke:${id}`),
    leaseForWorkspace: (sessionId: string) => options.leases?.[sessionId] ?? null,
  };
  if (options.matchingLeases !== null) {
    sessions.matchingLeasesForWorkspace = () => options.matchingLeases ?? [];
  }
  if (options.withAcross) {
    sessions.revokeWorkspaceAcrossMatching = (c: string, w: string) => log.push(`across:${c}:${w}`);
  }
  const service = new ConnectionWorkspaceGrantService({
    db: { exec: (sql: string) => log.push(sql) } as any,
    oauthRepo: {
      getConnection: () =>
        options.connection === undefined ? { status: 'ACTIVE', actor: 'oauth:x' } : options.connection,
    },
    workspaceRepo: { get: () => (options.workspace === undefined ? { id: 'w1' } : options.workspace) },
    sessionRepo: {
      rememberWorkspaceGrant: (...args: string[]) => {
        if (options.failRepo) throw new Error('disk full');
        log.push(`remember:${args.join(':')}`);
      },
      revokeLease: (id: string) => log.push(`db-revoke:${id}`),
      saveLease: (lease: any) => log.push(`save:${lease.sessionId}`),
      forgetWorkspaceGrant: () => {
        if (options.failRepo) throw new Error('disk full');
        return options.forget ?? false;
      },
      listRememberedWorkspaceGrants: () => [
        { subject: 'conn', workspaceId: 'w1', profileId: 'developer' },
      ],
    } as any,
    profiles: {
      get: () => (options.profile === undefined ? { capabilities: ['files.read'] } : options.profile),
    } as any,
    sessions,
    ...(options.now ? { now: options.now } : {}),
    ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
  });
  return { service, log, applied };
}

function errorOf(fn: () => unknown) {
  try {
    fn();
  } catch (error: any) {
    return { message: error.message, code: error.code, status: error.status };
  }
  assert.fail('expected an error');
}

test('grant rejects blank or missing identifiers', () => {
  const { service } = harness();
  const cases: Array<[any, string]> = [
    [{ workspaceId: 'w', profileId: 'p' }, 'connectionId is required'],
    [{ connectionId: ' c ', profileId: 'p' }, 'workspaceId is required'],
    [{ connectionId: 'c', workspaceId: 'w' }, 'profileId is required'],
  ];
  for (const [input, message] of cases) {
    assert.deepEqual(errorOf(() => service.grant(input)), {
      message,
      code: 'INVALID_REQUEST',
      status: 400,
    });
  }
});

test('grant maps missing connection, inactive connection, workspace and profile', () => {
  const input = { connectionId: 'c', workspaceId: 'w1', profileId: 'p' };
  assert.deepEqual(errorOf(() => harness({ connection: null }).service.grant(input)), {
    message: 'OAuth connection not found',
    code: 'NOT_FOUND',
    status: 404,
  });
  assert.equal(
    errorOf(() => harness({ connection: { status: 'REVOKED', actor: 'a' } }).service.grant(input))
      .status,
    409,
  );
  assert.equal(errorOf(() => harness({ workspace: null }).service.grant(input)).message, 'workspace not found');
  assert.equal(errorOf(() => harness({ profile: null }).service.grant(input)).message, 'profile not found');
});

test('grant uses injected clock and idle window, replacing existing leases', () => {
  const fx = harness({
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    idleMs: 1000,
    sessions: [{ id: 's1', actor: 'oauth:x' }, { id: 's2', actor: 'oauth:x' }],
    leases: { s1: { id: 'old-s1' } },
    matchingLeases: [
      { id: 'old-s1', sessionId: 's1', actor: 'oauth:x', expiresAt: 'x' },
      { id: 'detached', sessionId: 's9', actor: 'oauth:x', expiresAt: '2027-01-01T00:00:00.000Z' },
    ],
  });
  const result = fx.service.grant({ connectionId: 'c', workspaceId: 'w1', profileId: 'p' });
  assert.deepEqual(result.appliedSessionIds, ['s1', 's2']);
  assert.deepEqual(
    fx.applied.map((lease) => [lease.sessionId, lease.expiresAt]),
    [
      ['s1', '2026-01-01T00:00:01.000Z'],
      ['s2', '2026-01-01T00:00:01.000Z'],
      ['s9', '2027-01-01T00:00:00.000Z'],
    ],
  );
  assert.ok(fx.log.includes('db-revoke:old-s1'));
  assert.ok(fx.log.includes('db-revoke:detached'));
  assert.equal(fx.log.filter((line) => line === 'db-revoke:old-s1').length, 1);
  assert.equal(fx.log.at(-1), 'mem-revoke:detached');
});

test('grant without matchingLeasesForWorkspace uses defaults and rolls back on failure', () => {
  const plain = harness({ matchingLeases: null, sessions: [{ id: 's1', actor: 'a' }] });
  const before = Date.now();
  plain.service.grant({ connectionId: 'c', workspaceId: 'w1', profileId: 'p' });
  const expires = Date.parse(plain.applied[0].expiresAt);
  assert.ok(expires >= before + 30 * 60_000 - 5 && expires <= Date.now() + 30 * 60_000);
  const failing = harness({ failRepo: true });
  assert.throws(
    () => failing.service.grant({ connectionId: 'c', workspaceId: 'w1', profileId: 'p' }),
    /disk full/,
  );
  assert.deepEqual(failing.log, ['BEGIN IMMEDIATE', 'ROLLBACK']);
});

test('remove returns false for blank ids and validates the connection', () => {
  const { service } = harness();
  assert.deepEqual(service.remove('', 'w1'), { removed: false });
  assert.deepEqual(service.remove(undefined as any, 'w1'), { removed: false });
  assert.deepEqual(service.remove('c', null as any), { removed: false });
  assert.equal(errorOf(() => harness({ connection: null }).service.remove('c', 'w')).status, 404);
  assert.equal(
    errorOf(() => harness({ connection: { status: 'PENDING', actor: 'a' } }).service.remove('c', 'w'))
      .code,
    'CONFLICT',
  );
});

test('remove falls back to per-session leases and reports lease-only removals', () => {
  const fx = harness({
    matchingLeases: null,
    sessions: [{ id: 's1' }, { id: 's2' }],
    leases: { s2: { id: 'lease-s2' } },
    withAcross: true,
  });
  assert.deepEqual(fx.service.remove(' c ', ' w1 '), { removed: true });
  assert.deepEqual(fx.log, [
    'BEGIN IMMEDIATE',
    'db-revoke:lease-s2',
    'COMMIT',
    'mem-revoke:lease-s2',
    'across:c:w1',
  ]);
  const nothing = harness({ matchingLeases: [] });
  assert.deepEqual(nothing.service.remove('c', 'w1'), { removed: false });
  assert.deepEqual(harness({ forget: true }).service.remove('c', 'w1'), { removed: true });
});

test('remove rolls back when the repository fails', () => {
  const fx = harness({ failRepo: true, matchingLeases: [{ id: 'l1' }] });
  assert.throws(() => fx.service.remove('c', 'w1'), /disk full/);
  assert.deepEqual(fx.log, ['BEGIN IMMEDIATE', 'ROLLBACK']);
});

test('list trims ids and maps remembered grants', () => {
  const { service } = harness();
  assert.deepEqual(service.list('  '), []);
  assert.deepEqual(service.list(undefined as any), []);
  assert.deepEqual(service.list('conn'), [
    { connectionId: 'conn', workspaceId: 'w1', profileId: 'developer' },
  ]);
});
