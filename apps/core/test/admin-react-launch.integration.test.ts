import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { AdminBootstrapService } from '../src/admin/bootstrap.js';
import { AdminServer } from '../src/admin/server.js';

test('legacy bootstrap routes cannot mint an authenticated browser session', async () => {
  const db = AevraDatabase.open(':memory:');
  const bootstrap = new AdminBootstrapService(db.raw());
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    controlSecret: 'secret',
  });
  await server.start();
  try {
    const localBootstrap = await fetch(`${server.url()}/api/local/bootstrap`, {
      method: 'POST',
      headers: { 'x-aevra-control': 'secret' },
    });
    assert.equal(localBootstrap.status, 401);
    assert.equal(localBootstrap.headers.get('set-cookie'), null);

    const browserBootstrap = await fetch(`${server.url()}/auth/bootstrap?token=legacy`, {
      redirect: 'manual',
    });
    assert.equal(browserBootstrap.status, 404);
    assert.equal(browserBootstrap.headers.get('set-cookie'), null);
    assert.equal(browserBootstrap.headers.get('location'), null);
  } finally {
    await server.close();
    db.close();
  }
});

test('admin static server exposes one React build from the root', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aevra-web-'));
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), 'react');
  writeFileSync(path.join(dir, 'assets', 'app.js'), 'export default 1;');
  writeFileSync(path.join(dir, 'aevra-logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    staticDir: dir,
  });
  await server.start();
  try {
    const root = await fetch(`${server.url()}/`);
    assert.equal(root.status, 200);
    assert.equal(await root.text(), 'react');

    const removedCompatibility = await fetch(`${server.url()}/react/`);
    assert.equal(removedCompatibility.status, 404);

    const asset = await fetch(`${server.url()}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'text/javascript');
    assert.equal(await asset.text(), 'export default 1;');

    const logo = await fetch(`${server.url()}/aevra-logo.png`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get('content-type'), 'image/png');
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
