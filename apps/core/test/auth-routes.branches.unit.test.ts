import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAuthRoutes } from '../src/admin/routes/auth-routes.js';

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

function limiter(allowed = true, retryAfter = 0) {
  const events: string[] = [];
  return {
    events,
    allow: (ip: string) => (events.push(`allow:${ip}`), allowed),
    retryAfterSeconds: () => retryAfter,
    recordFailure: (ip: string) => events.push(`fail:${ip}`),
    refund: (ip: string) => events.push(`refund:${ip}`),
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
    loginLimiter: limiter(),
    secure: true,
    sameOrigin: true,
    clientIp: '127.0.0.1',
    ...overrides,
  };
}

async function call(ctx: any, path: string, method: string, raw = '') {
  const res = response();
  const handled = await handleAuthRoutes(request(method, raw), res, new URL(`https://localhost${path}`), ctx);
  return { handled, res, value: res.body ? JSON.parse(res.body) : undefined };
}

test('login body problems map to 413 and 400 without touching the limiter', async () => {
  const ctx = context();
  const big = await call(ctx, '/api/auth/login', 'POST', 'x'.repeat(8 * 1024 + 1));
  assert.deepEqual([big.res.statusCode, big.value], [413, { error: 'Invalid request' }]);
  const bad = await call(ctx, '/api/auth/login', 'POST', '{broken');
  assert.deepEqual([bad.res.statusCode, bad.value], [400, { error: 'Invalid request' }]);
  assert.deepEqual(ctx.loginLimiter.events, []);
});

test('an empty login body verifies blank credentials and records a failure', async () => {
  const ctx = context();
  const result = await call(ctx, '/api/auth/login', 'POST');
  assert.equal(result.res.statusCode, 401);
  assert.deepEqual(ctx.seen, [['', '']]);
  assert.deepEqual(ctx.loginLimiter.events, ['allow:127.0.0.1', 'fail:127.0.0.1']);
  await call(ctx, '/api/auth/login', 'POST', JSON.stringify({ username: 5, password: ['p'] }));
  assert.deepEqual(ctx.seen[1], ['', '']);
});

test('rate-limited logins only send retry-after for a positive finite wait', async () => {
  for (const [wait, header] of [
    [30, '30'],
    [0, undefined],
    [Number.POSITIVE_INFINITY, undefined],
  ] as const) {
    const ctx = context({ loginLimiter: limiter(false, wait) });
    const result = await call(ctx, '/api/auth/login', 'POST', '{}');
    assert.equal(result.res.statusCode, 429);
    assert.equal(result.res.headers['retry-after'], header);
  }
});

test('successful login over plain local HTTP sets a non-Secure cookie and refunds', async () => {
  const ctx = context({ secure: false, allowLocalHttpPassword: true });
  const result = await call(ctx, '/api/auth/login', 'POST', JSON.stringify({ username: 'admin', password: 'sample value' }));
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.headers['set-cookie'], 'aevra_admin=new%20session; HttpOnly; SameSite=Strict; Path=/');
  assert.deepEqual(ctx.loginLimiter.events, ['allow:127.0.0.1', 'refund:127.0.0.1']);
});

test('insecure login without a warning hook is still rejected', async () => {
  const result = await call(context({ secure: false }), '/api/auth/login', 'POST', '{}');
  assert.deepEqual([result.res.statusCode, result.value.error.code], [400, 'HTTPS_REQUIRED']);
  let warned = 0;
  const hooked = await call(context({ secure: false, onInsecureLoginBlocked: () => warned++ }), '/api/auth/login', 'POST', '{}');
  assert.equal(hooked.res.statusCode, 400);
  assert.equal(warned, 1);
});

test('logout enforces same-origin and a live session, then clears the cookie', async () => {
  const csrf = await call(context({ sameOrigin: false, sessionId: 'live' }), '/api/auth/logout', 'POST');
  assert.deepEqual([csrf.res.statusCode, csrf.value.error.code], [403, 'CSRF_REJECTED']);
  const stale = await call(context({ sessionId: 'old' }), '/api/auth/logout', 'POST');
  assert.deepEqual([stale.res.statusCode, stale.value], [401, { error: 'admin session required' }]);
  const ctx = context({ sessionId: 'live' });
  const ok = await call(ctx, '/api/auth/logout', 'POST');
  assert.deepEqual(ok.value, { authenticated: false });
  assert.deepEqual(ctx.revoked, ['live']);
  assert.equal(ok.res.headers['set-cookie'], 'aevra_admin=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
});

test('session probe reports validity and unknown auth routes fall through', async () => {
  assert.deepEqual((await call(context({ sessionId: 'live' }), '/api/auth/session', 'GET')).value, {
    authenticated: true,
  });
  assert.equal((await call(context(), '/api/auth/session', 'POST')).handled, false);
  assert.equal((await call(context(), '/api/auth/other', 'GET')).handled, false);
});
