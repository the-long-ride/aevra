import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { deriveBrowserTokenKey } from '../../../packages/security/src/browser-token-key.js';
import { BrowserPairingService } from '../src/browser/pairing-service.js';

const ext = 'abcdefghijklmnopabcdefghijklmnop';
const profile = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const hasCode = (code: string) => (error: any) => error?.code === code;

function harness(initial?: unknown, now: () => number = () => Date.now()) {
  const store = new Map<string, unknown>();
  if (initial !== undefined) store.set('browser.pairing', initial);
  const writes: unknown[] = [];
  let respond: (input: any) => any = (input) => ({
    ok: true,
    value: { activePairingId: null, epoch: input.operation.epoch },
  });
  const executed: any[] = [];
  const secret = randomBytes(32);
  const subject = new BrowserPairingService(
    {
      get: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
      set: (key: string, value: unknown) => {
        writes.push(value);
        store.set(key, value);
      },
    } as any,
    { execute: async (input: any) => (executed.push(input), respond(input)) } as any,
    () => deriveBrowserTokenKey(secret),
    { now },
  );
  return { subject, store, writes, executed, setWorker: (fn: typeof respond) => (respond = fn) };
}

test('constructor rewrites legacy settings but leaves registry settings untouched', () => {
  const legacy = harness({ extensionId: ext });
  assert.equal(legacy.writes.length, 1);
  assert.equal(legacy.subject.pairedExtensionId(), ext);
  assert.equal(legacy.subject.workerPairings()[0]!.legacy, true);
  const registry = harness({ epoch: 2, pairings: [] });
  assert.equal(registry.writes.length, 0);
  assert.equal(registry.subject.pairedExtensionId(), null);
  assert.equal(registry.subject.epoch(), 2);
});

test('state reports pending codes until expiry and marks the active pairing', async () => {
  let clock = 1_000_000;
  const { subject } = harness(undefined, () => clock);
  const empty = subject.state();
  assert.equal(empty.extensionId, null);
  assert.equal(empty.pairedAt, null);
  assert.equal(empty.pendingCode, false);
  const { code, expiresAt } = subject.createCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(subject.state().pendingExpiresAt, expiresAt);
  await subject.redeem({
    code: code.toLowerCase(),
    extensionId: ext,
    profileId: profile.toUpperCase(),
  });
  const state = subject.state({ worker: { activePairingId: profile } } as any);
  assert.equal(state.pairings[0]!.connected, true);
  assert.equal(state.pairings[0]!.profileName, 'Browser profile 11111111');
  subject.createCode();
  clock += 5 * 60_000;
  assert.equal(subject.state().pendingCode, false);
  assert.equal(subject.state(null).pairings[0]!.connected, false);
});

test('redeem rejects missing codes and invalid profile ids, and replaces same-profile pairings', async () => {
  const { subject } = harness();
  await assert.rejects(
    () => subject.redeem({ code: 'X', extensionId: ext, profileId: profile }),
    hasCode('PAIRING_CODE_INVALID'),
  );
  let code = subject.createCode().code;
  await assert.rejects(
    () => subject.redeem({ code, extensionId: ext, profileId: 'nope' }),
    hasCode('PROFILE_ID_INVALID'),
  );
  code = subject.createCode().code;
  await assert.rejects(
    () => subject.redeem({ code, extensionId: ext, profileId: undefined as any }),
    hasCode('PROFILE_ID_INVALID'),
  );
  code = subject.createCode().code;
  const first = await subject.redeem({
    code,
    extensionId: ext,
    profileId: profile,
    profileName: '  Work  ',
  });
  assert.equal(first.wsUrl, `ws://127.0.0.1:${Number(process.env.AEVRA_BROWSER_PORT ?? 47833)}`);
  code = subject.createCode().code;
  await subject.redeem({ code, extensionId: ext, profileId: other });
  code = subject.createCode().code;
  await subject.redeem({ code, extensionId: ext, profileId: profile, profileName: 'Home' });
  assert.deepEqual(
    subject.workerPairings().map((p) => `${p.pairingId}:${p.profileName}`),
    [`${other}:Browser profile 22222222`, `${profile}:Home`],
  );
});

test('pairingHealth renames the active profile from worker reports', async () => {
  const { subject, setWorker, writes } = harness();
  const code = subject.createCode().code;
  await subject.redeem({ code, extensionId: ext, profileId: profile, profileName: 'Old' });
  const before = writes.length;
  setWorker(() => ({
    ok: true,
    value: { activePairingId: profile, activeProfileName: `  ${'r'.repeat(130)} ` },
  }));
  await subject.pairingHealth();
  assert.equal(subject.workerPairings()[0]!.profileName, 'r'.repeat(120));
  assert.equal(writes.length, before + 1);
  setWorker(() => ({
    ok: true,
    value: { activePairingId: profile, activeProfileName: ' Renamed ' },
  }));
  await subject.pairingHealth();
  assert.equal(subject.workerPairings()[0]!.profileName, 'Renamed');
  await subject.pairingHealth();
  assert.equal(writes.length, before + 2);
  setWorker(() => ({ ok: true, value: { activePairingId: 'unknown', activeProfileName: 'Name' } }));
  await subject.pairingHealth();
  setWorker(() => ({ ok: true, value: { activePairingId: profile, activeProfileName: '  ' } }));
  await subject.pairingHealth();
  setWorker(() => ({ ok: true, value: null }));
  assert.equal((await subject.pairingHealth()).worker, null);
  assert.equal(writes.length, before + 2);
});

test('pairingHealth maps worker failures to known sync codes', async () => {
  const { subject, setWorker } = harness();
  for (const [code, expected] of [
    ['WORKER_TIMEOUT', 'WORKER_TIMEOUT'],
    ['BROWSER_UNAVAILABLE', 'BROWSER_UNAVAILABLE'],
    ['SOMETHING_ELSE', 'WORKER_UNAVAILABLE'],
  ]) {
    setWorker(() => ({ ok: false, error: { code } }));
    const health = await subject.pairingHealth();
    assert.equal(health.worker, null);
    assert.equal(health.syncErrorCode, expected);
  }
  setWorker(() => {
    throw new Error('plain failure');
  });
  assert.equal((await subject.pairingHealth()).syncErrorCode, 'WORKER_UNAVAILABLE');
});

test('unpair removes one pairing, reports missing ids, and flags pending sync', async () => {
  const { subject, setWorker, executed } = harness();
  for (const id of [profile, other]) {
    const code = subject.createCode().code;
    await subject.redeem({ code, extensionId: ext, profileId: id });
  }
  await assert.rejects(
    () => subject.unpair('missing'),
    (error: any) => error.code === 'BROWSER_PAIRING_NOT_FOUND' && error.status === 404,
  );
  const state = await subject.unpair(other);
  assert.deepEqual(
    state.pairings.map((p) => p.pairingId),
    [profile],
  );
  assert.deepEqual(
    executed.at(-1).operation.pairings.map((p: any) => p.pairingId),
    [profile],
  );
  setWorker(() => ({ ok: false, error: { code: 'WORKER_TIMEOUT' } }));
  await assert.rejects(
    () => subject.unpair(profile),
    (error: any) => error.code === 'BROWSER_PAIRING_SYNC_PENDING' && error.status === 503,
  );
  assert.deepEqual(subject.workerPairings(), []);
  assert.equal(executed.at(-1).operation.extensionId, '');
});

test('revokeAll reports pending sync when the worker refuses the disconnect', async () => {
  const { subject, setWorker } = harness();
  setWorker(() => ({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } }));
  await assert.rejects(() => subject.revokeAll(), hasCode('BROWSER_PAIRING_SYNC_PENDING'));
  assert.equal(subject.epoch(), 2);
});
