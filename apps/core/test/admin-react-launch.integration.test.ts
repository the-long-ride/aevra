import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { AdminBootstrapService } from '../src/admin/bootstrap.js';
import { AdminServer } from '../src/admin/server.js';

async function issue(server: AdminServer) {
  const response = await fetch(`${server.url()}/api/local/bootstrap`, {
    method: 'POST',
    headers: { 'x-aevra-control': 'secret' },
  });
  assert.equal(response.status, 200);
  return ((await response.json()) as { token: string }).token;
}

test('admin bootstrap redirects only to the React root and preserves rejected tokens', async () => {
  const db = AevraDatabase.open(':memory:');
  const bootstrap = new AdminBootstrapService(db.raw());
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    controlSecret: 'secret',
  });
  await server.start();
  try {
    const rootToken = await issue(server);
    const root = await fetch(
      `${server.url()}/auth/bootstrap?token=${rootToken}&to=${encodeURIComponent('/')}`,
      { redirect: 'manual' },
    );
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/');

    const protectedToken = await issue(server);
    const rejected = await fetch(
      `${server.url()}/auth/bootstrap?token=${protectedToken}&to=${encodeURIComponent('/react/')}`,
      { redirect: 'manual' },
    );
    assert.equal(rejected.status, 400);

    const retry = await fetch(
      `${server.url()}/auth/bootstrap?token=${protectedToken}&to=${encodeURIComponent('/')}`,
      { redirect: 'manual' },
    );
    assert.equal(retry.status, 302);
    assert.equal(retry.headers.get('location'), '/');
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
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
