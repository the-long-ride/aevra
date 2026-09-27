import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asObject,
  fallbackProfileName,
  normalizeStoredPairing,
  validExtensionId,
} from '../src/browser/pairing-storage.js';

const ext = 'abcdefghijklmnopabcdefghijklmnop';
const profile = '11111111-1111-4111-8111-111111111111';
const epochZero = new Date(0).toISOString();

test('asObject, validExtensionId, and fallbackProfileName guard their inputs', () => {
  assert.equal(asObject(null), null);
  assert.equal(asObject([1]), null);
  assert.equal(asObject('text'), null);
  assert.deepEqual(asObject({ a: 1 }), { a: 1 });
  assert.equal(validExtensionId(ext), true);
  assert.equal(validExtensionId('ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP'), false);
  assert.equal(validExtensionId(42), false);
  assert.equal(fallbackProfileName(profile), 'Browser profile 11111111');
  assert.equal(fallbackProfileName(null), 'Legacy browser profile');
});

test('epoch defaults to 1 unless it is a positive safe integer', () => {
  assert.deepEqual(normalizeStoredPairing(undefined), { epoch: 1, pairings: [] });
  assert.equal(normalizeStoredPairing({ epoch: 0 }).epoch, 1);
  assert.equal(normalizeStoredPairing({ epoch: 2.5 }).epoch, 1);
  assert.equal(normalizeStoredPairing({ epoch: '7' }).epoch, 1);
  assert.equal(normalizeStoredPairing({ epoch: 7 }).epoch, 7);
});

test('registry entries are dropped when shape or legacy rules are violated', () => {
  const { pairings } = normalizeStoredPairing({
    pairings: [
      null,
      'text',
      { extensionId: 'bad' },
      { extensionId: ext, profileId: profile },
      { extensionId: ext, credentialId: 'cred-a' },
      { extensionId: ext, profileId: 'not-a-uuid', credentialId: 'cred-a' },
      { extensionId: ext, profileId: profile, credentialId: '' },
      { extensionId: ext, legacy: true, profileId: profile },
      { extensionId: ext, legacy: true, credentialId: 'cred-a' },
    ],
  });
  assert.deepEqual(pairings, []);
});

test('registry entries default pairing id, date, and profile name', () => {
  const { pairings } = normalizeStoredPairing({
    epoch: 3,
    pairings: [
      { extensionId: ext, profileId: profile, credentialId: 'cred-a', pairedAt: 'not a date', profileName: '   ' },
      { extensionId: ext, legacy: true, pairedAt: 42 },
      {
        extensionId: ext,
        profileId: profile,
        credentialId: 'cred-b',
        pairingId: 'custom-id',
        pairedAt: '2026-01-01T00:00:00.000Z',
        profileName: `  ${'n'.repeat(130)}  `,
      },
    ],
  });
  assert.deepEqual(pairings[0], {
    pairingId: profile,
    profileId: profile,
    profileName: 'Browser profile 11111111',
    extensionId: ext,
    credentialId: 'cred-a',
    pairedAt: epochZero,
    legacy: false,
  });
  assert.equal(pairings[1]!.pairingId, `legacy-${ext}`);
  assert.equal(pairings[1]!.profileName, 'Legacy browser profile');
  assert.equal(pairings[1]!.pairedAt, epochZero);
  assert.equal(pairings[2]!.pairingId, 'custom-id');
  assert.equal(pairings[2]!.pairedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(pairings[2]!.profileName.length, 120);
});

test('single legacy record migrates, keeping a valid pairedAt only', () => {
  const migrated = normalizeStoredPairing({ extensionId: ext, pairedAt: '2025-05-05T00:00:00.000Z', epoch: 4 });
  assert.deepEqual(migrated, {
    epoch: 4,
    pairings: [
      {
        pairingId: `legacy-${ext}`,
        profileId: null,
        profileName: 'Legacy browser profile',
        extensionId: ext,
        credentialId: null,
        pairedAt: '2025-05-05T00:00:00.000Z',
        legacy: true,
      },
    ],
  });
  assert.equal(normalizeStoredPairing({ extensionId: ext, pairedAt: 'soon' }).pairings[0]!.pairedAt, epochZero);
  assert.equal(normalizeStoredPairing({ extensionId: ext }).pairings[0]!.pairedAt, epochZero);
  assert.deepEqual(normalizeStoredPairing({ extensionId: 'bad' }).pairings, []);
});
