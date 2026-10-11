import assert from 'node:assert/strict';
import test from 'node:test';
import { LoginThrottle, type LoginLockoutEvent } from '../src/admin/login-throttle.js';

const MINUTE = 60_000;

function clock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

function attempt(throttle: LoginThrottle, ip: string, username: string) {
  const result = throttle.begin(ip, username);
  if (!result.allowed) throw new Error(`blocked for ${result.retryAfterSeconds}s`);
  return result;
}

function fail(throttle: LoginThrottle, ip: string, username: string): LoginLockoutEvent[] {
  return attempt(throttle, ip, username).failure();
}

function failTimes(throttle: LoginThrottle, ip: string, username: string, count: number) {
  const events: LoginLockoutEvent[] = [];
  for (let index = 0; index < count; index++) events.push(...fail(throttle, ip, username));
  return events;
}

test('five failures for one ip and username lock that pair for a minute', () => {
  const time = clock();
  const throttle = new LoginThrottle({ now: time.now });

  assert.deepEqual(failTimes(throttle, '198.51.100.7', 'admin', 4), []);
  assert.deepEqual(fail(throttle, '198.51.100.7', 'admin'), [
    { scope: 'ip-username', ip: '198.51.100.7', lockSeconds: 60, level: 1 },
  ]);

  assert.deepEqual(throttle.begin('198.51.100.7', 'admin'), {
    allowed: false,
    retryAfterSeconds: 60,
  });
  time.advance(59_000);
  assert.deepEqual(throttle.begin('198.51.100.7', 'admin'), {
    allowed: false,
    retryAfterSeconds: 1,
  });
  time.advance(1000);
  assert.equal(throttle.begin('198.51.100.7', 'admin').allowed, true);
});

test('each further lockout doubles the lock and caps at one hour', () => {
  const time = clock();
  const throttle = new LoginThrottle({ now: time.now, ipThreshold: 1000 });
  const seen: number[] = [];

  for (let round = 0; round < 8; round++) {
    const [event] = failTimes(throttle, '198.51.100.7', 'admin', 5);
    assert.equal(event?.level, round + 1);
    seen.push(event!.lockSeconds);
    time.advance(event!.lockSeconds * 1000);
  }

  assert.deepEqual(seen, [60, 120, 240, 480, 960, 1920, 3600, 3600]);
});

test('failures older than the window stop counting', () => {
  const time = clock();
  const throttle = new LoginThrottle({ now: time.now });

  failTimes(throttle, '198.51.100.7', 'admin', 4);
  time.advance(15 * MINUTE);
  assert.deepEqual(fail(throttle, '198.51.100.7', 'admin'), []);

  const recent = new LoginThrottle({ now: time.now });
  failTimes(recent, '198.51.100.7', 'admin', 4);
  time.advance(14 * MINUTE);
  assert.equal(fail(recent, '198.51.100.7', 'admin').length, 1);
});

test('the lock level decays after a quiet window', () => {
  const time = clock();
  const throttle = new LoginThrottle({ now: time.now });

  const [first] = failTimes(throttle, '198.51.100.7', 'admin', 5);
  assert.equal(first?.lockSeconds, 60);
  time.advance(60_000 + 15 * MINUTE);
  const [second] = failTimes(throttle, '198.51.100.7', 'admin', 5);
  assert.deepEqual([second?.level, second?.lockSeconds], [1, 60]);
});

test('a successful login clears the pair counter but not the address-wide one', () => {
  const throttle = new LoginThrottle({ pairThreshold: 5, ipThreshold: 8 });

  failTimes(throttle, '198.51.100.7', 'admin', 4);
  attempt(throttle, '198.51.100.7', 'admin').success();
  assert.deepEqual(failTimes(throttle, '198.51.100.7', 'admin', 3), []);
  attempt(throttle, '198.51.100.7', 'admin').success();

  const events = failTimes(throttle, '198.51.100.7', 'other', 1);
  assert.deepEqual(
    events.map((event) => event.scope),
    ['ip'],
  );
});

test('an address that guesses many usernames is locked for every username', () => {
  const throttle = new LoginThrottle();
  const events: LoginLockoutEvent[] = [];
  for (let index = 0; index < 20; index++) {
    events.push(...fail(throttle, '198.51.100.7', `user-${index}`));
  }

  assert.deepEqual(events, [{ scope: 'ip', ip: '198.51.100.7', lockSeconds: 60, level: 1 }]);
  assert.equal(throttle.begin('198.51.100.7', 'never-tried').allowed, false);
  assert.equal(throttle.begin('203.0.113.9', 'user-0').allowed, true);
});

test('a locked pair does not affect the same username from another address', () => {
  const throttle = new LoginThrottle();
  failTimes(throttle, '198.51.100.7', 'admin', 5);

  assert.equal(throttle.begin('198.51.100.7', 'admin').allowed, false);
  assert.equal(throttle.begin('203.0.113.9', 'admin').allowed, true);
  assert.equal(throttle.begin('198.51.100.7', 'someone-else').allowed, true);
});

test('usernames are compared case-insensitively and trimmed', () => {
  const throttle = new LoginThrottle();
  for (const name of ['Admin', ' admin ', 'ADMIN', 'admin', 'aDmIn']) {
    fail(throttle, '198.51.100.7', name);
  }
  assert.equal(throttle.begin('198.51.100.7', 'admin').allowed, false);
});

test('attempts still being verified count toward the threshold', () => {
  const throttle = new LoginThrottle();
  const inFlight = Array.from({ length: 5 }, () => attempt(throttle, '198.51.100.7', 'admin'));

  assert.deepEqual(throttle.begin('198.51.100.7', 'admin'), {
    allowed: false,
    retryAfterSeconds: 1,
  });
  inFlight[0]!.abandon();
  assert.equal(throttle.begin('198.51.100.7', 'admin').allowed, true);
});

test('settling one attempt twice is ignored', () => {
  const throttle = new LoginThrottle({ pairThreshold: 2, ipThreshold: 1000 });
  const first = attempt(throttle, '198.51.100.7', 'admin');

  first.failure();
  assert.deepEqual(first.failure(), []);
  first.success();
  assert.equal(throttle.begin('198.51.100.7', 'admin').allowed, true);
});

test('a locked tracker survives key churn while idle ones are evicted', () => {
  const time = clock();
  const throttle = new LoginThrottle({ now: time.now, maxKeys: 2, ipThreshold: 1000 });
  failTimes(throttle, '198.51.100.7', 'target', 5);

  for (let index = 0; index < 6; index++) fail(throttle, '198.51.100.7', `churn-${index}`);

  assert.equal(throttle.begin('198.51.100.7', 'target').allowed, false);
});
