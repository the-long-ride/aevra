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
  return (await response.json() as { token: string }).token;
}

test('admin bootstrap redirects only to approved local UI destinations', async () => {
  const db = AevraDatabase.open(':memory:');
  const bootstrap = new AdminBootstrapService(db.raw());
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    controlSecret: 'secret',
  });
  await server.start();
  try {
    const reactToken = await issue(server);
    const react = await fetch(
      `${server.url()}/auth/bootstrap?token=${reactToken}&to=${encodeURIComponent('/react/')}`,
      { redirect: 'manual' },
    );
    assert.equal(react.status, 302);
    assert.equal(react.headers.get('location'), '/react/');

    const protectedToken = await issue(server);
    const rejected = await fetch(
      `${server.url()}/auth/bootstrap?token=${protectedToken}&to=${encodeURIComponent('https://evil.example')}`,
      { redirect: 'manual' },
    );
    assert.equal(rejected.status, 400);

    const retry = await fetch(
      `${server.url()}/auth/bootstrap?token=${protectedToken}&to=${encodeURIComponent('/react/')}`,
      { redirect: 'manual' },
    );
    assert.equal(retry.status, 302);
    assert.equal(retry.headers.get('location'), '/react/');
  } finally {
    await server.close();
    db.close();
  }
});

test('admin static server exposes vanilla and React builds from one static root', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aevra-web-'));
  mkdirSync(path.join(dir, 'react', 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), 'vanilla');
  writeFileSync(path.join(dir, 'react', 'index.html'), 'react');
  writeFileSync(path.join(dir, 'react', 'assets', 'app.js'), 'export default 1;');

  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    staticDir: dir,
  });
  await server.start();
  try {
    const vanilla = await fetch(`${server.url()}/`);
    assert.equal(vanilla.status, 200);
    assert.equal(await vanilla.text(), 'vanilla');

    const react = await fetch(`${server.url()}/react/`);
    assert.equal(react.status, 200);
    assert.equal(await react.text(), 'react');

    const asset = await fetch(`${server.url()}/react/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'text/javascript');
    assert.equal(await asset.text(), 'export default 1;');
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
