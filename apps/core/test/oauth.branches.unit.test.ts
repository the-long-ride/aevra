import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AevraOAuthService } from '../src/auth/oauth.js';

const verifier = 'sample-value-sample-value-sample-value-sample-value';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const RESOURCE = 'https://mcp.example.com/mcp';

function fakeRepo(overrides: Record<string, any> = {}) {
  const calls: string[] = [];
  const repo: any = {
    calls,
    getClient: (id: string) =>
      id === 'c1' ? { clientId: 'c1', clientName: 'Client One', redirectUris: ['https://app/cb'] } : null,
    createAuthorizationRequest: (input: any) => ({ id: 'req1', ...input }),
    getAuthorizationRequest: () => null,
    listPendingAuthorizationRequests: () => [],
    approveAuthorizationRequest: () => null,
    denyAuthorizationRequest: () => null,
    issueAuthorizationCode: () => ({ code: 'code-1' }),
    consumeAuthorizationCode: () => null,
    findRefreshToken: () => null,
    rotateRefreshTokenSecurely: () => (calls.push('rotate'), { status: 'ROTATED', nextToken: 'next' }),
    issueAccessToken: () => ({ token: 'access' }),
    issueRefreshToken: () => ({ token: 'refresh' }),
    ensureConnection: () => calls.push('ensure'),
    findAccessToken: () => null,
    getConnection: () => null,
    touchConnection: (s: string) => calls.push(`touch:${s}`),
    recordConnectionOrigin: (s: string, ip: string) => calls.push(`origin:${s}:${ip}`),
    listConnectionOrigins: (s: string) => [`${s}-origin`],
    revokeToken: (t: string) => calls.push(`revokeToken:${t}`),
    revokeConnection: (s: string, r: string) => calls.push(`revokeConnection:${s}:${r}`),
    getLatestRefreshFamily: (s: string) => ({ family: s }),
    ...overrides,
  };
  return repo;
}

function service(repo: any, audit?: any[]) {
  return new AevraOAuthService(repo, {
    issuer: 'https://mcp.example.com/',
    resource: RESOURCE,
    ...(audit ? { audit: { append: (entry: any) => audit.push(entry) } } : {}),
  } as any);
}

const goodAuthorize = {
  client_id: 'c1',
  redirect_uri: 'https://app/cb',
  response_type: 'code',
  code_challenge: challenge,
  code_challenge_method: 'S256',
};

test('beginAuthorization validates each request field in order', () => {
  const oauth = service(fakeRepo());
  assert.throws(() => oauth.beginAuthorization({ ...goodAuthorize, client_id: undefined } as any), /unknown OAuth client_id/);
  assert.throws(() => oauth.beginAuthorization({ ...goodAuthorize, response_type: 'token' } as any), /response_type must be code/);
  assert.throws(() => oauth.beginAuthorization({ ...goodAuthorize, redirect_uri: 'https://evil/cb' } as any), /redirect_uri does not exactly match/);
  assert.throws(() => oauth.beginAuthorization({ ...goodAuthorize, code_challenge_method: 'plain' } as any), /S256/);
  assert.throws(() => oauth.beginAuthorization({ ...goodAuthorize, code_challenge: '' } as any), /code_challenge is required/);
  assert.throws(() => oauth.beginAuthorization({ ...goodAuthorize, code_challenge: 'short' } as any), /code_challenge is required/);
  const pending = oauth.beginAuthorization(goodAuthorize as any);
  assert.equal(pending.scope, 'mcp');
  assert.equal(pending.resource, RESOURCE);
});

test('pending authorization listing falls back to the client id when the client is gone', () => {
  const oauth = service(
    fakeRepo({
      listPendingAuthorizationRequests: () => [
        { id: 'r1', clientId: 'c1', scope: 'mcp  offline_access' },
        { id: 'r2', clientId: 'ghost', scope: 'mcp' },
      ],
    }),
  );
  const rows = oauth.listPendingAuthorizations();
  assert.deepEqual(
    rows.map((row: any) => [row.id, row.clientName, row.requestedScopes]),
    [
      ['r1', 'Client One', ['mcp', 'offline_access']],
      ['r2', 'ghost', ['mcp']],
    ],
  );
});

test('approve and deny reject unknown requests and return found ones', () => {
  const missing = service(fakeRepo());
  assert.throws(() => missing.approveAuthorization('x'), /not found/);
  assert.throws(() => missing.denyAuthorization('x'), /not found/);
  const found = service(
    fakeRepo({
      approveAuthorizationRequest: (id: string, o: any) => ({ id, status: 'APPROVED', o }),
      denyAuthorizationRequest: (id: string) => ({ id, status: 'DENIED' }),
    }),
  );
  assert.deepEqual(found.approveAuthorization('a', { renewable: true }), {
    id: 'a',
    status: 'APPROVED',
    o: { renewable: true },
  });
  assert.deepEqual(found.denyAuthorization('d'), { id: 'd', status: 'DENIED' });
});

test('continueAuthorization omits state when the request had none', () => {
  const oauth = service(
    fakeRepo({
      getAuthorizationRequest: () => ({ status: 'APPROVED', redirectUri: 'https://app/cb' }),
    }),
  );
  const url = new URL(oauth.continueAuthorization('req1').redirectUrl);
  assert.equal(url.searchParams.get('code'), 'code-1');
  assert.equal(url.searchParams.get('iss'), 'https://mcp.example.com');
  assert.equal(url.searchParams.has('state'), false);
  const pending = service(fakeRepo({ getAuthorizationRequest: () => ({ status: 'PENDING' }) }));
  assert.throws(() => pending.continueAuthorization('req1'), /not approved/);
});

function codeRecord(extra: Record<string, unknown> = {}) {
  return {
    clientId: 'c1',
    redirectUri: 'https://app/cb',
    resource: RESOURCE,
    codeChallenge: challenge,
    actor: 'oauth:Client One',
    subject: 'conn-1',
    scope: 'mcp offline_access',
    ...extra,
  };
}

const exchange = {
  grant_type: 'authorization_code',
  client_id: 'c1',
  code: 'code-1',
  redirect_uri: 'https://app/cb',
  code_verifier: verifier,
} as const;

test('authorization code exchange rejects every binding failure', () => {
  const none = service(fakeRepo());
  assert.throws(() => none.exchangeAuthorizationCode({ ...exchange, grant_type: 'x' } as any), /unsupported grant_type/);
  assert.throws(() => none.exchangeAuthorizationCode(exchange as any), /invalid authorization code/);
  for (const mismatch of [{ clientId: 'c2' }, { redirectUri: 'https://app/other' }, { resource: 'https://other/mcp' }]) {
    const oauth = service(fakeRepo({ consumeAuthorizationCode: () => codeRecord(mismatch) }));
    assert.throws(() => oauth.exchangeAuthorizationCode(exchange as any), /binding mismatch/);
  }
  const bound = service(fakeRepo({ consumeAuthorizationCode: () => codeRecord() }));
  assert.throws(() => bound.exchangeAuthorizationCode({ ...exchange, code_verifier: '' } as any), /code_verifier is invalid/);
  assert.throws(
    () => bound.exchangeAuthorizationCode({ ...exchange, code_verifier: 'x'.repeat(50) } as any),
    /PKCE verification failed/,
  );
});

test('code exchange honours renewable flags when issuing refresh tokens', () => {
  const audit: any[] = [];
  const renewable = service(fakeRepo({ consumeAuthorizationCode: () => codeRecord({ renewable: true, scope: 'mcp' }) }), audit);
  const withRefresh = renewable.exchangeAuthorizationCode(exchange as any);
  assert.equal(withRefresh.refresh_token, 'refresh');
  assert.equal(audit[0].metadata.refreshIssued, true);
  const fixed = service(fakeRepo({ consumeAuthorizationCode: () => codeRecord({ renewable: false }) }));
  const noRefresh = fixed.exchangeAuthorizationCode(exchange as any);
  assert.equal(noRefresh.scope, 'mcp');
  assert.equal(noRefresh.refresh_token, undefined);
  const implicit = service(fakeRepo({ consumeAuthorizationCode: () => codeRecord({ scope: 'mcp' }) }));
  assert.equal(implicit.exchangeAuthorizationCode(exchange as any).refresh_token, undefined);
});

const refresh = { grant_type: 'refresh_token', client_id: 'c1', refresh_token: 'r1' } as const;
const activeRefresh = { clientId: 'c1', resource: RESOURCE, status: 'ACTIVE', scope: 'mcp offline_access', actor: 'oauth:C', subject: 'conn-1' };

test('refresh exchange audits binding failures with an unknown actor when client id is blank', () => {
  const audit: any[] = [];
  const oauth = service(fakeRepo(), audit);
  assert.throws(() => oauth.exchangeRefreshToken({ ...refresh, grant_type: 'nope' } as any), /unsupported grant_type/);
  assert.throws(() => oauth.exchangeRefreshToken({ ...refresh, client_id: '' } as any), /invalid refresh token/);
  assert.equal(audit[0].actor, 'unknown');
  const wrongClient = service(fakeRepo({ findRefreshToken: () => ({ ...activeRefresh, clientId: 'c9' }) }), audit);
  assert.throws(() => wrongClient.exchangeRefreshToken(refresh as any), /invalid refresh token/);
  assert.equal(audit[1].actor, 'client:c1');
  const wrongResource = service(fakeRepo({ findRefreshToken: () => ({ ...activeRefresh, resource: 'x' }) }));
  assert.throws(() => wrongResource.exchangeRefreshToken(refresh as any), /invalid refresh token/);
});

test('refresh exchange rejects spent tokens, excess scope and lost rotation races', () => {
  const audit: any[] = [];
  const spentRepo = fakeRepo({ findRefreshToken: () => ({ ...activeRefresh, status: 'ROTATED' }) });
  assert.throws(() => service(spentRepo, audit).exchangeRefreshToken(refresh as any), /invalid refresh token/);
  assert.deepEqual(spentRepo.calls, ['rotate']);
  assert.equal(audit[0].metadata.reason, 'refresh_token_spent_or_inactive');
  const narrow = fakeRepo({ findRefreshToken: () => ({ ...activeRefresh, scope: 'mcp' }) });
  assert.throws(
    () => service(narrow, audit).exchangeRefreshToken({ ...refresh, scope: 'mcp offline_access' } as any),
    /exceeds original grant/,
  );
  assert.equal(audit[1].metadata.reason, 'scope_exceeds_grant');
  assert.deepEqual(narrow.calls, []);
  const raced = fakeRepo({
    findRefreshToken: () => activeRefresh,
    rotateRefreshTokenSecurely: () => ({ status: 'REUSED' }),
  });
  assert.throws(() => service(raced).exchangeRefreshToken(refresh as any), /invalid refresh token/);
});

test('refresh exchange narrows scope when asked and keeps it otherwise', () => {
  const oauth = service(fakeRepo({ findRefreshToken: () => activeRefresh }));
  const narrowed = oauth.exchangeRefreshToken({ ...refresh, scope: 'mcp' } as any);
  assert.deepEqual([narrowed.scope, narrowed.refresh_token], ['mcp', 'next']);
  assert.equal(oauth.exchangeRefreshToken(refresh as any).scope, 'mcp offline_access');
});

test('access token verification checks resource and connection state and records origins', () => {
  const record = { resource: RESOURCE, subject: 'conn-1', actor: 'oauth:C', expiresAt: 'later' };
  assert.throws(() => service(fakeRepo()).verifyAccessToken('t'), /invalid OAuth access token/);
  assert.throws(
    () => service(fakeRepo({ findAccessToken: () => ({ ...record, resource: 'other' }) })).verifyAccessToken('t'),
    /invalid OAuth access token/,
  );
  assert.throws(
    () => service(fakeRepo({ findAccessToken: () => record })).verifyAccessToken('t'),
    /invalid OAuth access token/,
  );
  assert.throws(
    () =>
      service(
        fakeRepo({ findAccessToken: () => record, getConnection: () => ({ status: 'REVOKED' }) }),
      ).verifyAccessToken('t'),
    /invalid OAuth access token/,
  );
  const repo = fakeRepo({ findAccessToken: () => record, getConnection: () => ({ status: 'ACTIVE' }) });
  const oauth = service(repo);
  const withIp = oauth.verifyAccessToken('t', '10.0.0.1');
  assert.equal(withIp.connectionId, 'conn-1');
  oauth.verifyAccessToken('t');
  assert.deepEqual(repo.calls, ['touch:conn-1', 'origin:conn-1:10.0.0.1', 'touch:conn-1']);
});

test('connection management helpers delegate to the repository', () => {
  const repo = fakeRepo();
  const oauth = service(repo);
  oauth.recordConnectionOrigin('conn-2', '10.0.0.2');
  assert.deepEqual(oauth.listConnectionOrigins('conn-2'), ['conn-2-origin']);
  oauth.revoke('tok');
  oauth.revokeConnection('conn-2');
  oauth.revokeConnection('conn-3', 'EXPIRED');
  assert.deepEqual(oauth.getLatestRefreshFamily('conn-2'), { family: 'conn-2' });
  assert.deepEqual(repo.calls, [
    'origin:conn-2:10.0.0.2',
    'revokeToken:tok',
    'revokeConnection:conn-2:ADMIN_REVOKE',
    'revokeConnection:conn-3:EXPIRED',
  ]);
  assert.equal(oauth.authorizationStatus('gone').status, 'EXPIRED');
});

test('public base URL must be a bare HTTPS origin', () => {
  const oauth = service(fakeRepo());
  for (const bad of ['http://x.example', 'https://x.example/path', 'https://x.example/?q=1', 'https://x.example/#h']) {
    assert.throws(() => oauth.setPublicBaseUrl(bad), /HTTPS origin/);
  }
  oauth.setPublicBaseUrl('https://pub.example/');
  assert.equal(oauth.issuer, 'https://pub.example');
  assert.equal(oauth.resource, 'https://pub.example/mcp');
});
