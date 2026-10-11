import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAuthRoutes } from '../src/admin/routes/auth-routes.js';
import type { LoginLockoutEvent } from '../src/admin/login-throttle.js';

const plainPhrase1 = 'sample value';

function request(method: string, raw = '') {
  const stream = Readable.from(raw ? [Buffer.from(raw)] : []) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      result.headers[key] = value;
    },
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

function throttle(options: { retryAfter?: number; lockouts?: LoginLockoutEvent[] } = {}) {
  const events: string[] = [];
  return {
    events,
    begin: (ip: string, username: string) => {
      events.push(`begin:${ip}:${username}`);
      if (options.retryAfter !== undefined) {
        return { allowed: false, retryAfterSeconds: options.retryAfter };
      }
      return {
        allowed: true,
        failure: () => (events.push('failure'), options.lockouts ?? []),
        success: () => events.push('success'),
        abandon: () => events.push('abandon'),
      };
    },
  } as any;
}

function context(overrides: Record<string, any> = {}) {
  const revoked: string[] = [];
  const seen: string[][] = [];
  return {
    revoked,
    seen,
    sessions: {
      validateSession: (id?: string) => id === 'live',
      issueSession: async () => ({ sessionId: 'new session' }),
      revokeSession: (id: string) => revoked.push(id),
    } as any,
    credentialVerifier: {
      verify: async (user: string, pass: string) => (seen.push([user, pass]), user === 'admin'),
    } as any,
    loginThrottle: throttle(),
    secure: true,
    sameOrigin: true,
    clientIp: '127.0.0.1',
    ...overrides,
  };
}

async function call(ctx: any, path: string, method: string, raw = '') {
  const res = response();
  const handled = await handleAuthRoutes(
    request(method, raw),
    res,
    new URL(`https://localhost${path}`),
    ctx,
  );
  return { handled, res, value: res.body ? JSON.parse(res.body) : undefined };
}

test('login body problems map to 413 and 400 without touching the throttle', async () => {
  const ctx = context();
  const big = await call(ctx, '/api/auth/login', 'POST', 'x'.repeat(8 * 1024 + 1));
  assert.deepEqual([big.res.statusCode, big.value], [413, { error: 'Invalid request' }]);
  const bad = await call(ctx, '/api/auth/login', 'POST', '{broken');
  assert.deepEqual([bad.res.statusCode, bad.value], [400, { error: 'Invalid request' }]);
  assert.deepEqual(ctx.loginThrottle.events, []);
});

test('an empty login body verifies blank credentials and records a failure', async () => {
  const ctx = context();
  const result = await call(ctx, '/api/auth/login', 'POST');
  assert.equal(result.res.statusCode, 401);
  assert.deepEqual(ctx.seen, [['', '']]);
  assert.deepEqual(ctx.loginThrottle.events, ['begin:127.0.0.1:', 'failure']);
  await call(ctx, '/api/auth/login', 'POST', JSON.stringify({ username: 5, password: ['p'] }));
  assert.deepEqual(ctx.seen[1], ['', '']);
});

test('a locked login answers 429 with retry-after and never verifies credentials', async () => {
  const ctx = context({ loginThrottle: throttle({ retryAfter: 30 }) });
  const result = await call(
    ctx,
    '/api/auth/login',
    'POST',
    JSON.stringify({ username: 'admin', password: plainPhrase1 }),
  );
  assert.deepEqual(
    [result.res.statusCode, result.value],
    [429, { error: 'Too many login attempts' }],
  );
  assert.equal(result.res.headers['retry-after'], '30');
  assert.deepEqual(ctx.seen, []);
});

test('a failed login reports each lockout the throttle triggered', async () => {
  const lockout: LoginLockoutEvent = {
    scope: 'ip-username',
    ip: '127.0.0.1',
    lockSeconds: 60,
    level: 1,
  };
  const reported: LoginLockoutEvent[] = [];
  const ctx = context({
    loginThrottle: throttle({ lockouts: [lockout] }),
    onLoginLockout: (event: LoginLockoutEvent) => reported.push(event),
  });
  const result = await call(ctx, '/api/auth/login', 'POST', '{}');
  assert.deepEqual([result.res.statusCode, result.value], [401, { error: 'Invalid credentials' }]);
  assert.deepEqual(reported, [lockout]);
});

test('a credential check that throws releases the attempt', async () => {
  const ctx = context({
    credentialVerifier: {
      verify: async () => {
        throw new Error('verifier down');
      },
    },
  });
  await assert.rejects(call(ctx, '/api/auth/login', 'POST', '{}'), /verifier down/);
  assert.deepEqual(ctx.loginThrottle.events, ['begin:127.0.0.1:', 'abandon']);
});

test('successful login over plain local HTTP sets a non-Secure cookie and clears the pair', async () => {
  const ctx = context({ secure: false, allowLocalHttpPassword: true });
  const result = await call(
    ctx,
    '/api/auth/login',
    'POST',
    JSON.stringify({ username: 'admin', password: plainPhrase1 }),
  );
  assert.equal(result.res.statusCode, 200);
  assert.equal(
    result.res.headers['set-cookie'],
    'aevra_admin=new%20session; HttpOnly; SameSite=Strict; Path=/',
  );
  assert.deepEqual(ctx.loginThrottle.events, ['begin:127.0.0.1:admin', 'success']);
});

test('insecure login without a warning hook is still rejected', async () => {
  const result = await call(context({ secure: false }), '/api/auth/login', 'POST', '{}');
  assert.deepEqual([result.res.statusCode, result.value.error.code], [400, 'HTTPS_REQUIRED']);
  let warned = 0;
  const hooked = await call(
    context({ secure: false, onInsecureLoginBlocked: () => warned++ }),
    '/api/auth/login',
    'POST',
    '{}',
  );
  assert.equal(hooked.res.statusCode, 400);
  assert.equal(warned, 1);
});

test('logout enforces same-origin and a live session, then clears the cookie', async () => {
  const csrf = await call(
    context({ sameOrigin: false, sessionId: 'live' }),
    '/api/auth/logout',
    'POST',
  );
  assert.deepEqual([csrf.res.statusCode, csrf.value.error.code], [403, 'CSRF_REJECTED']);
  const stale = await call(context({ sessionId: 'old' }), '/api/auth/logout', 'POST');
  assert.deepEqual([stale.res.statusCode, stale.value], [401, { error: 'admin session required' }]);
  const ctx = context({ sessionId: 'live' });
  const ok = await call(ctx, '/api/auth/logout', 'POST');
  assert.deepEqual(ok.value, { authenticated: false });
  assert.deepEqual(ctx.revoked, ['live']);
  assert.equal(
    ok.res.headers['set-cookie'],
    'aevra_admin=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
  );
});

test('session probe reports validity and unknown auth routes fall through', async () => {
  assert.deepEqual((await call(context({ sessionId: 'live' }), '/api/auth/session', 'GET')).value, {
    authenticated: true,
  });
  assert.equal((await call(context(), '/api/auth/session', 'POST')).handled, false);
  assert.equal((await call(context(), '/api/auth/other', 'GET')).handled, false);
});
