import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { mintExtensionToken, verifyExtensionToken } from '../src/extension-token.js';
import { deriveBrowserTokenKey } from '../src/browser-token-key.js';

const secret = Buffer.from('a'.repeat(64), 'hex');
const claims = {
  extensionId: 'abcdefghijklmnopabcdefghijklmnop',
  epoch: 3,
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

test('a freshly minted token verifies at the current epoch', () => {
  const token = mintExtensionToken(secret, claims);
  const verified = verifyExtensionToken(secret, token, { epoch: 3 });
  assert.equal(verified.extensionId, claims.extensionId);
});

test('a token signed with a different secret is rejected', () => {
  const token = mintExtensionToken(Buffer.from('b'.repeat(64), 'hex'), claims);
  assert.throws(() => verifyExtensionToken(secret, token, { epoch: 3 }), /invalid token signature/);
});

test('bumping the epoch revokes every previously minted token', () => {
  const token = mintExtensionToken(secret, claims);
  assert.throws(() => verifyExtensionToken(secret, token, { epoch: 4 }), /revoked/);
});

test('an expired token is rejected', () => {
  const token = mintExtensionToken(secret, {
    ...claims,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.throws(() => verifyExtensionToken(secret, token, { epoch: 3 }), /expired/);
});

test('a tampered payload does not verify', () => {
  const token = mintExtensionToken(secret, claims);
  const [payload, mac] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
  decoded.epoch = 99;
  const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${mac}`;
  assert.throws(
    () => verifyExtensionToken(secret, forged, { epoch: 99 }),
    /invalid token signature/,
  );
});

test('a malformed token is rejected without throwing a parse error to the caller', () => {
  assert.throws(() => verifyExtensionToken(secret, 'garbage', { epoch: 3 }), /malformed token/);
});

test('the derived browser key is stable and is not the worker secret', () => {
  const workerSecret = randomBytes(32);
  const derived = deriveBrowserTokenKey(workerSecret);
  assert.equal(derived.length, 32);
  assert.deepEqual(derived, deriveBrowserTokenKey(workerSecret));
  assert.notDeepEqual(derived, workerSecret);
});

test('a token minted under the derived key does not verify under the raw secret', () => {
  const workerSecret = randomBytes(32);
  const token = mintExtensionToken(deriveBrowserTokenKey(workerSecret), claims);
  assert.throws(
    () => verifyExtensionToken(workerSecret, token, { epoch: 3 }),
    /invalid token signature/,
  );
});
