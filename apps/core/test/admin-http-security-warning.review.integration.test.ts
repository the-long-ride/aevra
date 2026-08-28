import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { AdminCredentialVerifier } from '../src/admin/admin-credentials.js';
import { AdminBootstrapService } from '../src/admin/bootstrap.js';
import { AdminServer } from '../src/admin/server.js';

test('blocked insecure Admin login emits rate-limited safe guidance', async () => {
  const database = AevraDatabase.open(':memory:');
  const bootstrap = new AdminBootstrapService(database.raw());
  const credentialVerifier = await AdminCredentialVerifier.create('admin', 'secret');
  const warnings: string[] = [];
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    credentialVerifier,
    onSecurityWarning: (line: string) => warnings.push(line),
  } as any);

  await server.start();
  try {
    const attempt = () =>
      fetch(`${server.url()}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: server.url() },
        body: JSON.stringify({ username: 'admin', password: 'secret' }),
      });

    assert.equal((await attempt()).status, 400);
    assert.deepEqual(warnings, [
      '[aevra] Admin login blocked: insecure password submission.',
      '[aevra] HTTP login is allowed only in explicit Local HTTP mode from a loopback connection.',
      '[aevra] Use the local gateway or switch Local transport to HTTPS.',
    ]);

    assert.equal((await attempt()).status, 400);
    assert.equal(warnings.length, 3);
    assert.equal(
      warnings.some((line) => /admin|secret/i.test(line.replace(/^\[aevra\]\s*/i, ''))),
      true,
    );
    assert.equal(
      warnings.some((line) => /password=|username=|aevra_admin=/i.test(line)),
      false,
    );
  } finally {
    await server.close();
    database.close();
  }
});
