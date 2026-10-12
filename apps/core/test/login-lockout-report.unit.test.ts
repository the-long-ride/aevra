import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoginLockoutReporter } from '../src/admin/login-lockout-report.js';
import type { LoginLockoutEvent } from '../src/admin/login-throttle.js';

const event: LoginLockoutEvent = {
  scope: 'ip-username',
  ip: '198.51.100.7',
  lockSeconds: 60,
  level: 1,
};

function harness(options: { auditThrows?: boolean } = {}) {
  let current = 1_000_000;
  const audited: unknown[] = [];
  const notices: Array<[string, string]> = [];
  const audit = {
    append: (input: unknown) => {
      if (options.auditThrows) throw new Error('disk full');
      audited.push(input);
      return {} as never;
    },
  };
  const report = createLoginLockoutReporter(
    audit,
    (title, message) => notices.push([title, message]),
    () => current,
  );
  return {
    audited,
    notices,
    report,
    advance(ms: number) {
      current += ms;
    },
  };
}

test('a lockout is written to the audit log as a security event', () => {
  const { audited, report } = harness();
  report(event);
  assert.deepEqual(audited, [
    {
      operation: 'admin.login.lockout',
      target: 'ip-username',
      remoteIp: '198.51.100.7',
      decision: 'deny',
      result: 'locked 60s (level 1)',
      redactionCount: 0,
      class: 'security',
    },
  ]);
});

test('a lockout raises a desktop notification naming the address and duration', () => {
  const { notices, report } = harness();
  report({ ...event, lockSeconds: 3600, level: 7 });
  assert.deepEqual(notices, [
    [
      'Aevra: admin sign-in locked',
      'Locked for 1h after repeated failed sign-ins from 198.51.100.7.',
    ],
  ]);
});

test('notifications are limited to one a minute but every lockout is audited', () => {
  const { audited, notices, report, advance } = harness();
  report(event);
  advance(30_000);
  report(event);
  assert.equal(audited.length, 2);
  assert.equal(notices.length, 1);
  advance(30_000);
  report(event);
  assert.equal(notices.length, 2);
});

test('an audit failure neither throws nor suppresses the notification', () => {
  const { notices, report } = harness({ auditThrows: true });
  assert.doesNotThrow(() => report(event));
  assert.equal(notices.length, 1);
});

test('reporting works without an audit service', () => {
  const notices: string[] = [];
  const report = createLoginLockoutReporter(undefined, (title) => notices.push(title));
  report(event);
  assert.deepEqual(notices, ['Aevra: admin sign-in locked']);
});
