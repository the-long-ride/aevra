import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { CloudflareAccessVerifier, RejectingIdentityVerifier } from '../src/auth/cloudflare.js';
import { createTestIssuer } from './support/test-issuer.js';

function req(headers: Record<string, string>) {
  return { headers } as any;
}

function part(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

test('bearer authorization is accepted and other schemes are rejected', async () => {
  const i = createTestIssuer();
  const v = new CloudflareAccessVerifier(i.issuer, i.audience, i.provider);
  const id = await v.verifyRequest(req({ authorization: `Bearer ${i.sign()}` }));
  assert.equal(id.subject, 'sub-1');
  assert.equal(id.issuer, i.issuer);
  await assert.rejects(() => v.verifyRequest(req({ authorization: 'Basic abc' })), /missing Cloudflare Access JWT/);
  await assert.rejects(() => v.verifyRequest(req({ 'cf-access-jwt-assertion': 'a.b' })), /invalid JWT/);
});

test('header and claim validation reject each malformed token', async () => {
  const i = createTestIssuer();
  const v = new CloudflareAccessVerifier(i.issuer, i.audience, i.provider);
  const verify = (token: string) => v.verifyRequest(req({ 'cf-access-jwt-assertion': token }));
  const claims = { iss: i.issuer, aud: i.audience, sub: 's', exp: Math.floor(Date.now() / 1000) + 60 };
  await assert.rejects(() => verify(`${part({ alg: 'HS256' })}.${part(claims)}.x`), /unsupported JWT algorithm/);
  await assert.rejects(() => verify(i.sign({ exp: 'soon' })), /expired JWT/);
  await assert.rejects(() => verify(i.sign({ sub: '' })), /missing subject/);
  await assert.rejects(() => verify(i.sign({ sub: 7 })), /missing subject/);
  await assert.rejects(() => verify(i.sign({ email: '' })), /missing actor claim/);
  await assert.rejects(() => verify(i.sign({ email: 42 })), /missing actor claim/);
  await assert.rejects(
    () => verify(`${part({ alg: 'RS256', kid: 'other' })}.${part(claims)}.x`),
    /unknown JWT key/,
  );
});

test('actor falls back to preferred_username then subject, and audience may be a list', async () => {
  const i = createTestIssuer();
  const v = new CloudflareAccessVerifier(i.issuer, i.audience, i.provider);
  const verify = (token: string) => v.verifyRequest(req({ 'cf-access-jwt-assertion': token }));
  const username = await verify(i.sign({ email: undefined, preferred_username: 'bob', aud: ['x', i.audience] }));
  assert.equal(username.actor, 'bob');
  const subject = await verify(i.sign({ email: undefined }));
  assert.equal(subject.actor, 'sub-1');
  await assert.rejects(() => verify(i.sign({ aud: ['x', 'y'] })), /wrong JWT audience/);
});

test('a signature from another token is rejected', async () => {
  const i = createTestIssuer();
  const v = new CloudflareAccessVerifier(i.issuer, i.audience, i.provider);
  const [a, b] = i.sign({ sub: 'first' }).split('.');
  const signature = i.sign({ sub: 'second' }).split('.')[2];
  await assert.rejects(
    () => v.verifyRequest(req({ 'cf-access-jwt-assertion': `${a}.${b}.${signature}` })),
    /invalid JWT signature/,
  );
});

test('rejecting verifier always refuses', async () => {
  await assert.rejects(() => new RejectingIdentityVerifier().verifyRequest(req({})), /not configured/);
});

async function jwksServer(status: number, body: unknown) {
  let hits = 0;
  const server = http.createServer((request, response) => {
    hits++;
    response.statusCode = request.url === '/cdn-cgi/access/certs' ? status : 404;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return {
    issuer: `http://127.0.0.1:${address.port}`,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('default JWKS provider fetches certs once and serves later calls from cache', async () => {
  const probe = createTestIssuer();
  const keys = (await probe.provider.get()).keys;
  const server = await jwksServer(200, { keys });
  try {
    // The loopback issuer serves the probe keys, so sign with a matching issuer.
    const verifier = new CloudflareAccessVerifier(server.issuer, 'aud-local');
    const token = probe.sign({ iss: server.issuer, aud: 'aud-local' });
    const first = await verifier.verifyRequest(req({ 'cf-access-jwt-assertion': token }));
    const second = await verifier.verifyRequest(req({ 'cf-access-jwt-assertion': token }));
    assert.equal(first.actor, 'alice@example.com');
    assert.equal(second.subject, 'sub-1');
    assert.equal(server.hits(), 1);
  } finally {
    await server.close();
  }
});

test('default JWKS provider surfaces HTTP failures', async () => {
  const probe = createTestIssuer();
  const server = await jwksServer(503, { error: 'down' });
  try {
    const verifier = new CloudflareAccessVerifier(server.issuer, 'aud-local');
    const token = probe.sign({ iss: server.issuer, aud: 'aud-local' });
    await assert.rejects(
      () => verifier.verifyRequest(req({ 'cf-access-jwt-assertion': token })),
      /JWKS 503/,
    );
  } finally {
    await server.close();
  }
});
