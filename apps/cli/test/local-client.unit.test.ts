import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { localAdminBase, localAdminFetch } from '../src/local-client.js';

function fakeResponse(statusCode: number) {
  const response = new EventEmitter() as any;
  response.statusCode = statusCode;
  response.statusMessage = 'OK';
  response.headers = { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] };
  return response;
}

function captureRequests(captured: any[], responses: any[]) {
  const pending = new EventEmitter() as any;
  pending.write = (value: unknown) => {
    captured.push({ wrote: value });
  };
  pending.end = () => {};
  return test.mock.method(https, 'request', (options: any, callback: any) => {
    captured.push({ options });
    const respond = responses.shift() ?? fakeResponse(200);
    process.nextTick(() => {
      callback(respond);
      process.nextTick(() => {
        respond.emit('data', Buffer.from('{"ok":true}'));
        respond.emit('end');
      });
    });
    return pending;
  });
}

test('localAdminBase points at the loopback admin port', () => {
  assert.equal(localAdminBase({ adminPort: 4126 } as any), 'https://localhost:4126');
});

test('localAdminFetch sends content length uses managed CA and builds a Response', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-local-client-'));
  mkdirSync(path.join(dir, 'tls'), { recursive: true });
  writeFileSync(path.join(dir, 'tls', 'localhost-cert.pem'), 'managed-cert');
  const captured: any[] = [];
  const mock = captureRequests(captured, [fakeResponse(200)]);
  try {
    const response = await localAdminFetch(
      { adminPort: 4199, stateDir: dir } as any,
      '/api/dashboard',
      { method: 'POST', body: 'payload' },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(response.headers.getSetCookie(), ['a=1', 'b=2']);
    assert.equal(await response.text(), '{"ok":true}');
    assert.equal(captured[0].options.port, 4199);
    assert.equal(captured[0].options.ca.toString(), 'managed-cert');
    assert.equal(captured[0].options.headers['content-length'], '7');
    assert.equal(captured.at(-1)?.wrote, 'payload');
  } finally {
    mock.mock.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localAdminFetch honors explicit CA files and skips CA when a certificate is set', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-local-client-'));
  const caPath = path.join(dir, 'custom-ca.pem');
  writeFileSync(caPath, 'custom-ca');
  const captured: any[] = [];
  const mock = captureRequests(captured, [fakeResponse(204), fakeResponse(204)]);
  try {
    await localAdminFetch({ adminPort: 4200, tlsCaPath: caPath } as any, '/api/status');
    await localAdminFetch(
      { adminPort: 4200, tlsCertPath: path.join(dir, 'cert.pem') } as any,
      '/api/status',
    );
    assert.equal(captured[0].options.ca.toString(), 'custom-ca');
    assert.equal(captured[1].options.ca, undefined);
  } finally {
    mock.mock.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localAdminFetch propagates transport errors as rejections', async () => {
  const failing = new EventEmitter() as any;
  failing.write = () => {};
  failing.end = () => {};
  process.nextTick(() => failing.emit('error', new Error('ECONNREFUSED')));
  const mock = test.mock.method(https, 'request', () => failing);
  try {
    await assert.rejects(
      () =>
        localAdminFetch({ adminPort: 4201 } as any, '/api/status', {
          body: Buffer.from('bytes'),
        }),
      /ECONNREFUSED/,
    );
  } finally {
    mock.mock.restore();
  }
});
