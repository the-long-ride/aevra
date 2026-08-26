import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreConfig } from '../src/config.js';

const baseEnv = {
  AEVRA_USERNAME: 'admin',
  AEVRA_PASSWORD: 'secret',
  AEVRA_STATE_DIR: '/tmp/aevra-config-continuity',
};

test('connection continuity duration defaults are stable', () => {
  const config = loadCoreConfig(baseEnv);
  assert.equal(config.oauthAccessTokenTtlMs, 60 * 60_000);
  assert.equal(config.oauthRefreshTokenTtlMs, 30 * 24 * 60 * 60_000);
  assert.equal(config.connectionReconnectGraceMs, 15 * 60_000);
});

test('connection continuity durations reject unsafe values', () => {
  assert.throws(
    () => loadCoreConfig({ ...baseEnv, AEVRA_OAUTH_ACCESS_TOKEN_TTL_MS: '0' }),
    /AEVRA_OAUTH_ACCESS_TOKEN_TTL_MS/,
  );
  assert.throws(
    () =>
      loadCoreConfig({
        ...baseEnv,
        AEVRA_OAUTH_ACCESS_TOKEN_TTL_MS: '3600000',
        AEVRA_OAUTH_REFRESH_TOKEN_TTL_MS: '3600000',
      }),
    /refresh token TTL must be greater than access token TTL/,
  );
  assert.throws(
    () => loadCoreConfig({ ...baseEnv, AEVRA_CONNECTION_RECONNECT_GRACE_MS: '-1' }),
    /AEVRA_CONNECTION_RECONNECT_GRACE_MS/,
  );
  assert.throws(
    () => loadCoreConfig({ ...baseEnv, AEVRA_OAUTH_REFRESH_TOKEN_TTL_MS: '9007199254740992' }),
    /AEVRA_OAUTH_REFRESH_TOKEN_TTL_MS/,
  );
});
