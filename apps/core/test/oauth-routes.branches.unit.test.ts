import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleOAuthRoute } from '../src/mcp/oauth-routes.js';

function request(
  method: string | undefined,
  raw = '',
  headers: Record<string, string> = {},
  ip = '10.1.1.1',
) {
  const stream = Readable.from(raw ? [Buffer.from(raw)] : []) as any;
  stream.method = method;
  stream.headers = headers;
  stream.socket = { remoteAddress: ip };
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      result.headers[key.toLowerCase()] = value;
    },
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

async function call(
  oauth: any,
  path: string,
  method?: string,
  raw = '',
  headers: Record<string, string> = {},
  ip?: string,
) {
  const res = response();
  const handled = await handleOAuthRoute(
    request(method, raw, headers, ip),
    res,
    new URL(`https://localhost${path}`),
    oauth,
  );
  return { handled, res };
}

function thrower(value: unknown) {
  return () => {
    throw value;
  };
}

test('no OAuth service means no OAuth routes', async () => {
  assert.equal((await call(undefined, '/oauth/token', 'POST')).handled, false);
});

test('OPTIONS preflight is answered on /mcp and nested MCP paths only', async () => {
  for (const path of ['/mcp', '/mcp/session', '/oauth/token']) {
    const { handled, res } = await call({}, path, 'OPTIONS');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['access-control-allow-origin'], '*');
  }
  assert.equal((await call({}, '/other', 'OPTIONS')).handled, false);
  assert.equal((await call({}, '/mcpx', 'OPTIONS')).handled, false);
});

test('metadata routes default to GET when the method is missing', async () => {
  const oauth = {
    protectedResourceMetadata: () => ({ kind: 'resource' }),
    authorizationServerMetadata: () => ({ kind: 'server' }),
  };
  const resource = await call(oauth, '/mcp/.well-known/oauth-protected-resource');
  assert.deepEqual(JSON.parse(resource.res.body), { kind: 'resource' });
  const server = await call(oauth, '/.well-known/oauth-authorization-server/mcp');
  assert.deepEqual(JSON.parse(server.res.body), { kind: 'server' });
  assert.equal(server.res.headers['cache-control'], 'no-store');
});

test('registration failures report invalid_client_metadata for errors and plain values', async () => {
  const errorResult = await call(
    { registerClient: thrower(new Error('bad uri')) },
    '/oauth/register',
    'POST',
    '{}',
    {},
    '10.2.0.1',
  );
  assert.equal(errorResult.res.statusCode, 400);
  assert.deepEqual(JSON.parse(errorResult.res.body), {
    error: 'invalid_client_metadata',
    error_description: 'bad uri',
  });
  const plain = await call(
    { registerClient: thrower('nope') },
    '/oauth/register',
    'POST',
    '',
    {},
    '10.2.0.2',
  );
  assert.equal(JSON.parse(plain.res.body).error_description, 'nope');
});

test('registration is rate limited per client address', async () => {
  const oauth = { registerClient: () => ({ client_id: 'x' }) };
  let last: any;
  for (let index = 0; index < 31; index++) {
    last = await call(oauth, '/oauth/register', 'POST', '{}', {}, '10.3.0.1');
  }
  assert.equal(last.res.statusCode, 429);
  assert.deepEqual(JSON.parse(last.res.body), { error: 'rate_limited' });
  assert.ok(Number(last.res.headers['retry-after']) >= 1);
  const other = await call(oauth, '/oauth/register', 'POST', '{}', {}, '10.3.0.2');
  assert.equal(other.res.statusCode, 201);
});

test('authorize passes empty defaults for missing query parameters and renders errors', async () => {
  let seen: any;
  const oauth = {
    beginAuthorization: (input: any, ip: string) => {
      seen = { input, ip };
      throw new Error('unknown <client>');
    },
  };
  const { res } = await call(oauth, '/oauth/authorize', 'GET', '', {}, '10.4.0.1');
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Connection request rejected/);
  assert.match(res.body, /unknown &lt;client&gt;/);
  assert.deepEqual(seen.input, {
    client_id: '',
    redirect_uri: '',
    response_type: '',
    scope: undefined,
    resource: undefined,
    code_challenge: '',
    code_challenge_method: '',
    state: undefined,
  });
  assert.equal(seen.ip, '10.4.0.1');
  const plain = await call({ beginAuthorization: thrower('stopped') }, '/oauth/authorize', 'GET');
  assert.match(plain.res.body, /<p>stopped<\/p>/);
});

test('authorize renders the approval page for a pending request', async () => {
  const oauth = { beginAuthorization: () => ({ id: 'req<1>', pairingCode: 'AB12' }) };
  const { res } = await call(oauth, '/oauth/authorize?client_id=c&state=s', 'GET');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /data-request-id="req&lt;1&gt;"/);
  assert.match(res.body, /AB12/);
});

test('status and continue use an empty request id by default', async () => {
  const ids: string[] = [];
  const oauth = {
    authorizationStatus: (id: string) => (ids.push(id), { status: 'PENDING' }),
    continueAuthorization: (id: string) => {
      ids.push(id);
      throw 'not yet';
    },
  };
  const status = await call(oauth, '/oauth/authorize/status');
  assert.deepEqual(JSON.parse(status.res.body), { status: 'PENDING' });
  const cont = await call(oauth, '/oauth/authorize/continue');
  assert.equal(cont.res.statusCode, 409);
  assert.match(cont.res.body, /Authorization unavailable/);
  assert.match(cont.res.body, /not yet/);
  assert.deepEqual(ids, ['', '']);
  const ok = await call(
    { continueAuthorization: () => ({ redirectUrl: 'https://app/cb?code=1' }) },
    '/oauth/authorize/continue?request_id=r1',
  );
  assert.equal(ok.res.statusCode, 302);
  assert.equal(ok.res.headers.location, 'https://app/cb?code=1');
});

test('token endpoint fills missing form fields with defaults for both grants', async () => {
  const seen: any[] = [];
  const oauth = {
    exchangeAuthorizationCode: (input: any) => (seen.push(input), { access_token: 'a' }),
    exchangeRefreshToken: (input: any) => (seen.push(input), { access_token: 'b' }),
  };
  const code = await call(oauth, '/oauth/token', 'POST', 'grant_type=authorization_code');
  assert.equal(code.res.statusCode, 200);
  const refresh = await call(
    oauth,
    '/oauth/token',
    'POST',
    JSON.stringify({ grant_type: 'refresh_token', scope: null }),
    {
      'content-type': 'application/json',
    },
  );
  assert.deepEqual(JSON.parse(refresh.res.body), { access_token: 'b' });
  assert.deepEqual(seen, [
    {
      grant_type: 'authorization_code',
      client_id: '',
      code: '',
      redirect_uri: '',
      code_verifier: '',
      resource: undefined,
    },
    {
      grant_type: 'refresh_token',
      client_id: '',
      refresh_token: '',
      resource: undefined,
      scope: undefined,
    },
  ]);
});

test('token endpoint reports invalid_grant for unsupported grants and thrown values', async () => {
  const unsupported = await call({}, '/oauth/token', 'POST', 'grant_type=password');
  assert.deepEqual(JSON.parse(unsupported.res.body), {
    error: 'invalid_grant',
    error_description: 'unsupported grant_type',
  });
  const plain = await call(
    { exchangeRefreshToken: thrower('spent') },
    '/oauth/token',
    'POST',
    'grant_type=refresh_token',
  );
  assert.equal(plain.res.statusCode, 400);
  assert.equal(JSON.parse(plain.res.body).error_description, 'spent');
});

test('revoke accepts an empty form and unknown OAuth paths return 404', async () => {
  const revoked: string[] = [];
  const oauth = { revoke: (token: string) => revoked.push(token) };
  const { res } = await call(oauth, '/oauth/revoke', 'POST');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(revoked, ['']);
  const missing = await call(oauth, '/.well-known/oauth-unknown');
  assert.deepEqual([missing.res.statusCode, missing.res.body], [404, 'Not Found']);
  const wrongMethod = await call(oauth, '/oauth/revoke', 'GET');
  assert.equal(wrongMethod.res.statusCode, 404);
  assert.equal((await call(oauth, '/api/other')).handled, false);
});
