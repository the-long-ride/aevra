import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { KnownDevices } from '../src/admin/known-devices.js';
import { LoginThrottle } from '../src/admin/login-throttle.js';
import { handleAuthRoutes } from '../src/admin/routes/auth-routes.js';

const RIGHT_PHRASE = 'correct horse phrase';

function request(body: unknown) {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as any;
  stream.method = 'POST';
  stream.headers = {};
  return stream;
}

function response() {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, unknown>,
    setHeader(key: string, value: unknown) {
      res.headers[key.toLowerCase()] = value;
    },
    end(value = '') {
      res.body = String(value);
    },
  };
  return res;
}

function context(loginThrottle: LoginThrottle, devices: KnownDevices, deviceId?: string) {
  return {
    sessions: { issueSession: async () => ({ sessionId: 'fresh session' }) } as any,
    credentialVerifier: { verify: async (_u: string, p: string) => p === RIGHT_PHRASE } as any,
    loginThrottle,
    devices,
    deviceId,
    secure: true,
    sameOrigin: true,
    clientIp: '127.0.0.1',
  };
}

async function login(ctx: any, password: string) {
  const res = response();
  await handleAuthRoutes(
    request({ username: 'admin', password }),
    res as any,
    new URL('https://localhost/api/auth/login'),
    ctx,
  );
  return res;
}

function deviceCookie(res: ReturnType<typeof response>) {
  const cookies = res.headers['set-cookie'];
  const list = Array.isArray(cookies) ? cookies : [cookies];
  return list.find((value) => String(value).startsWith('aevra_device=')) as string | undefined;
}

test('a successful sign-in issues a scoped known-device cookie', async () => {
  const devices = new KnownDevices();
  const res = await login(context(new LoginThrottle(), devices), RIGHT_PHRASE);
  assert.equal(res.statusCode, 200);
  const cookie = deviceCookie(res);
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/auth/);
  assert.match(cookie, /Max-Age=\d+/);
  assert.match(cookie, /Secure/);
  const id = decodeURIComponent(cookie.split(';')[0]!.slice('aevra_device='.length));
  assert.ok(devices.bucket(id));
});

test('a remote flood on the shared address does not lock out a known device', async () => {
  const throttle = new LoginThrottle({ pairThreshold: 2, ipThreshold: 2 });
  const devices = new KnownDevices();
  const owner = devices.issue();
  for (let i = 0; i < 2; i++) {
    assert.equal((await login(context(throttle, devices), 'wrong words')).statusCode, 401);
  }
  assert.equal((await login(context(throttle, devices), RIGHT_PHRASE)).statusCode, 429);
  assert.equal(
    (await login(context(throttle, devices, 'made up id'), RIGHT_PHRASE)).statusCode,
    429,
  );

  const ownerLogin = await login(context(throttle, devices, owner), RIGHT_PHRASE);
  assert.equal(ownerLogin.statusCode, 200);
  assert.equal(deviceCookie(ownerLogin), undefined);
});

test('known devices expire and stay bounded', () => {
  let now = 1_000;
  const devices = new KnownDevices({ ttlMs: 10_000, maxDevices: 2, now: () => now });
  const first = devices.issue();
  assert.ok(devices.bucket(first)?.startsWith('device:'));
  devices.issue();
  devices.issue();
  assert.equal(devices.bucket(first), undefined);
  const late = devices.issue();
  now += 10_000;
  assert.equal(devices.bucket(late), undefined);
  assert.equal(devices.bucket(undefined), undefined);
});
