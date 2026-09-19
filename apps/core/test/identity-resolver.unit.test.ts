import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { resolveMcpIdentity } from '../src/mcp/identity-resolver.js';
import { IpRateLimiter } from '../src/mcp/rate-limit.js';
import { ConnectionRateLimiter } from '../src/mcp/connection-rate-limit.js';

function fakeRequest(headers: Record<string, string>, remoteAddress = '198.51.100.1') {
  const stream = Readable.from([]) as any;
  stream.headers = headers;
  stream.socket = { remoteAddress };
  return stream;
}

function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(code: number, headers: Record<string, string>) {
      res.statusCode = code;
      res.headers = headers;
    },
    setHeader(name: string, val: string) {
      res.headers[name] = val;
    },
    end(data?: string) {
      res.body = data ?? '';
    },
  };
  return res as any;
}

test('failed OAuth Bearer token never debits connector limiter and challenge includes invalid_token', async () => {
  let connectorVerifyCount = 0;
  const connectors = {
    lookup: () => false,
    verify: async () => {
      connectorVerifyCount++;
      return { kind: 'rate-limited' as const };
    },
  };
  const oauth = {
    issuer: 'https://mcp.example.com',
    verifyAccessToken: () => {
      throw new Error('invalid OAuth access token');
    },
  } as any;

  const req = fakeRequest({ authorization: 'Bearer bad_oauth_token' });
  const res = fakeResponse();

  const identity = await resolveMcpIdentity(req, res, undefined, {
    connectors,
    oauth,
  });

  assert.equal(identity, null);
  assert.equal(res.statusCode, 401);
  assert.equal(connectorVerifyCount, 0, 'Failed OAuth token must never call connector verify');
  assert.ok(res.headers['www-authenticate']?.includes('error="invalid_token"'));
  assert.ok(
    res.headers['www-authenticate']?.includes(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    ),
  );
  assert.ok(res.headers['www-authenticate']?.includes('scope="mcp offline_access"'));
});

test('valid static connector token works even after invalid-bearer bucket is exhausted', async () => {
  const invalidBearerLimiter = new IpRateLimiter(2, 1);
  const connectors = {
    lookup: (token: string) => token === 'valid_connector_secret',
    verify: async (token: string) => {
      if (token === 'valid_connector_secret') {
        return {
          kind: 'admitted' as const,
          identity: {
            actor: 'connector:bot',
            subject: 'conn_1',
            issuer: 'aevra',
            audience: 'mcp',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        };
      }
      return { kind: 'denied' as const };
    },
  };

  // Exhaust invalid bearer limiter with random bad tokens
  for (let i = 0; i < 2; i++) {
    const req = fakeRequest({ authorization: `Bearer unknown_garbage_${i}` });
    const res = fakeResponse();
    await resolveMcpIdentity(req, res, undefined, { connectors, invalidBearerLimiter });
    assert.equal(res.statusCode, 401);
  }

  // 3rd unknown token gets 429
  {
    const req = fakeRequest({ authorization: 'Bearer unknown_garbage_3' });
    const res = fakeResponse();
    await resolveMcpIdentity(req, res, undefined, { connectors, invalidBearerLimiter });
    assert.equal(res.statusCode, 429);
    assert.ok(res.headers['retry-after']);
  }

  // Valid connector token is still admitted!
  {
    const req = fakeRequest({ authorization: 'Bearer valid_connector_secret' });
    const res = fakeResponse();
    const identity = await resolveMcpIdentity(req, res, undefined, {
      connectors,
      invalidBearerLimiter,
    });
    assert.ok(identity);
    assert.equal(identity.actor, 'connector:bot');
  }
});

test('valid OAuth token is throttled with 429 and Retry-After if connectionLimiter is exhausted', async () => {
  const connectionLimiter = new ConnectionRateLimiter({ capacity: 1, refillPerSecond: 1 });
  const oauth = {
    issuer: 'https://mcp.example.com',
    verifyAccessToken: () => ({
      actor: 'oauth:ChatGPT',
      subject: 'conn_chatgpt',
      connectionId: 'conn_chatgpt',
      issuer: 'https://mcp.example.com',
      audience: 'mcp',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
  } as any;

  // Request 1 succeeds
  {
    const req = fakeRequest({ authorization: 'Bearer valid_token' });
    const res = fakeResponse();
    const identity = await resolveMcpIdentity(req, res, undefined, { oauth, connectionLimiter });
    assert.ok(identity);
  }

  // Request 2 throttles on connection limiter
  {
    const req = fakeRequest({ authorization: 'Bearer valid_token' });
    const res = fakeResponse();
    const identity = await resolveMcpIdentity(req, res, undefined, { oauth, connectionLimiter });
    assert.equal(identity, null);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['retry-after'], '1');
  }
});
