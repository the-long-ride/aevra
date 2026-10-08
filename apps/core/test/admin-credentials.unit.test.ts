import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminCredentialVerifier, loadAdminCredentials } from '../src/admin/admin-credentials.js';

const plainPhrase1 = 'secret';
const plainPhrase2 = ' p ';

test('admin credentials are mandatory and preserve password whitespace', async () => {
  assert.throws(
    () => loadAdminCredentials({ AEVRA_USERNAME: 'admin' }),
    /ADMIN_CREDENTIALS_REQUIRED/,
  );
  assert.throws(
    () => loadAdminCredentials({ AEVRA_USERNAME: '   ', AEVRA_PASSWORD: plainPhrase1 }),
    /ADMIN_CREDENTIALS_REQUIRED/,
  );
  assert.deepEqual(
    loadAdminCredentials({ AEVRA_USERNAME: 'admin', AEVRA_PASSWORD: plainPhrase2 }),
    {
      username: 'admin',
      password: plainPhrase2,
    },
  );
});

test('admin credential verifier accepts only the configured username and password', async () => {
  const verifier = await AdminCredentialVerifier.create('admin', 'secret');
  assert.equal(await verifier.verify('admin', 'secret'), true);
  assert.equal(await verifier.verify('admin', 'wrong'), false);
  assert.equal(await verifier.verify('other', 'secret'), false);
});
