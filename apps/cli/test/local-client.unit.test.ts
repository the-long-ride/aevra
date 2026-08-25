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
  queueMicrotask(() => {
    response.emit('data', Buffer.from('{"ok":true}'));
    response.emit('end');
  });
  return response;
}

// Every awaited call is raced against a watchdog so a broken mock surfaces as a
// fast failure instead of hanging the whole unit batch.
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout in ${label}`)), 2000).unref?.(),
    ),
  ]);
}

test('localAdminBase points at the loopback admin port', () => {
  assert.equal(localAdminBase({ adminPort: 4126 } as any), 'https://localhost:4126');
});

test('localAdminFetch sends content length uses managed CA and builds a Response', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-local-client-'));
  mkdirSync(path.join(dir, 'tls'), { recursive: true });
  writeFileSync(path.join(dir, 'tls', 'localhost-cert.pem'), 'managed-cert');
  const captured: any[] = [];
  const originalRequest = https.request;
  test.mock.method(https, 'request', (options: any, callback: any) => {
    const pending = new EventEmitter() as any;
    pending.write = (value: unknown) => captured.push({ wrote: value });
    pending.end = () => {};
    captured.push({ options });
    queueMicrotask(() => callback(fakeResponse(200)));
    return pending;
  });
  try {
    const response = await withTimeout(
      localAdminFetch({ adminPort: 4199, stateDir: dir } as any, '/api/dashboard', {
        method: 'POST',
        body: 'payload',
      }),
      'managed-ca fetch',
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(response.headers.getSetCookie(), ['a=1', 'b=2']);
    assert.equal(await withTimeout(response.text(), 'managed-ca body'), '{"ok":true}');
    assert.equal(captured[0].options.port, 4199);
    assert.equal(captured[0].options.ca.toString(), 'managed-cert');
    assert.equal(captured[0].options.headers['content-length'], '7');
    assert.equal((captured.at(-1) as any)?.wrote, 'payload');
  } finally {
    https.request = originalRequest;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localAdminFetch honors explicit CA files and skips CA when a certificate is set', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-local-client-'));
  writeFileSync(path.join(dir, 'custom-ca.pem'), 'custom-ca');
  const captured: any[] = [];
  const originalRequest = https.request;
  test.mock.method(https, 'request', (options: any, callback: any) => {
    const pending = new EventEmitter() as any;
    pending.write = () => {};
    pending.end = () => {};
    captured.push({ options });
    queueMicrotask(() => callback(fakeResponse(204)));
    return pending;
  });
  try {
    await withTimeout(
      localAdminFetch(
        { adminPort: 4200, tlsCaPath: path.join(dir, 'custom-ca.pem') } as any,
        '/api/status',
      ),
      'explicit ca fetch',
    );
    await withTimeout(
      localAdminFetch(
        { adminPort: 4200, tlsCertPath: path.join(dir, 'cert.pem') } as any,
        '/api/status',
      ),
      'cert-priority fetch',
    );
    assert.equal(captured[0].options.ca.toString(), 'custom-ca');
    assert.equal(captured[1].options.ca, undefined);
  } finally {
    https.request = originalRequest;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localAdminFetch propagates transport errors as rejections', async () => {
  const failing = new EventEmitter() as any;
  failing.write = () => {};
  failing.end = () => {};
  process.nextTick(() => failing.emit('error', new Error('ECONNREFUSED')));
  const originalRequest = https.request;
  test.mock.method(https, 'request', () => failing);
  try {
    await assert.rejects(
      () =>
        withTimeout(
          localAdminFetch({ adminPort: 4201 } as any, '/api/status', {
            body: Buffer.from('bytes'),
          }),
          'transport error fetch',
        ),
      /ECONNREFUSED/,
    );
  } finally {
    https.request = originalRequest;
  }
});
