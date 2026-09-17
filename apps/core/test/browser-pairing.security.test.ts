import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { verifyExtensionToken } from '../../../packages/security/src/extension-token.js';
import { deriveBrowserTokenKey } from '../../../packages/security/src/browser-token-key.js';
import { BrowserPairingService } from '../src/browser/pairing-service.js';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';

/** Callers branch on the machine-readable code, not the prose message. */
function hasCode(code: string) {
  return (error: unknown) => (error as { code?: string }).code === code;
}

function service(now: () => number = () => Date.now()) {
  const store = new Map<string, unknown>();
  const executed: any[] = [];
  const secret = randomBytes(32);
  const subject = new BrowserPairingService(
    {
      get: (key: string, fallback: unknown) => store.get(key) ?? fallback,
      set: (key: string, value: unknown) => void store.set(key, value),
    } as any,
    { execute: async (input: any) => (executed.push(input), { ok: true, value: {} }) } as any,
    () => deriveBrowserTokenKey(secret),
    { now },
  );
  return { subject, executed, secret };
}

test('a pairing code redeems exactly once', async () => {
  const { subject } = service();
  const { code } = subject.createCode();
  assert.ok(await subject.redeem(code, extensionId));
  await assert.rejects(() => subject.redeem(code, extensionId), hasCode('PAIRING_CODE_INVALID'));
});

test('an unknown pairing code is rejected', async () => {
  const { subject } = service();
  subject.createCode();
  await assert.rejects(
    () => subject.redeem('ZZZZZZZZ', extensionId),
    hasCode('PAIRING_CODE_INVALID'),
  );
});

test('a pairing code expires after five minutes', async () => {
  let clock = 1_000_000;
  const { subject } = service(() => clock);
  const { code } = subject.createCode();
  clock += 5 * 60_000 + 1;
  await assert.rejects(() => subject.redeem(code, extensionId), hasCode('PAIRING_CODE_INVALID'));
});

test('a malformed extension id is rejected before any token is minted', async () => {
  const { subject } = service();
  const { code } = subject.createCode();
  await assert.rejects(
    () => subject.redeem(code, 'not a valid id'),
    hasCode('EXTENSION_ID_INVALID'),
  );
});

test('the minted token verifies against the derived key at the current epoch', async () => {
  const { subject, secret } = service();
  const { code } = subject.createCode();
  const result = await subject.redeem(code, extensionId);
  const claims = verifyExtensionToken(deriveBrowserTokenKey(secret), result.token, {
    epoch: subject.epoch(),
  });
  assert.equal(claims.extensionId, extensionId);
});

test('the minted token does not verify against the raw worker secret', async () => {
  const { subject, secret } = service();
  const { code } = subject.createCode();
  const result = await subject.redeem(code, extensionId);
  assert.throws(
    () => verifyExtensionToken(secret, result.token, { epoch: subject.epoch() }),
    /invalid token signature/,
  );
});

test('revokeAll bumps the epoch and pushes a disconnect envelope to the worker', async () => {
  const { subject, executed } = service();
  const before = subject.epoch();
  await subject.revokeAll();
  assert.equal(subject.epoch(), before + 1);
  const pushed = executed.at(-1);
  assert.equal(pushed.operation.kind, 'browser.disconnect');
  assert.equal(pushed.operation.all, true);
  assert.equal(pushed.operation.epoch, subject.epoch());
  assert.deepEqual(pushed.roots, []);
});

test('a token minted before a revocation no longer verifies at the new epoch', async () => {
  const { subject, secret } = service();
  const { code } = subject.createCode();
  const result = await subject.redeem(code, extensionId);
  await subject.revokeAll();
  assert.throws(
    () =>
      verifyExtensionToken(deriveBrowserTokenKey(secret), result.token, {
        epoch: subject.epoch(),
      }),
    /revoked/,
  );
});

test('state never exposes the token or the pairing code', async () => {
  const { subject } = service();
  const { code } = subject.createCode();
  await subject.redeem(code, extensionId);
  const state = subject.state();
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes(code), false);
  assert.equal(state.extensionId, extensionId);
  assert.equal(typeof state.epoch, 'number');
  assert.equal(Object.prototype.hasOwnProperty.call(state, 'token'), false);
});
