import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import test from 'node:test';
import { localAdminBase, localAdminFetch } from '../src/local-client.js';

function responseDouble() {
  const response = new EventEmitter() as any;
  response.statusCode = 200;
  response.statusMessage = 'OK';
  response.headers = { 'content-type': 'application/json' };
  queueMicrotask(() => {
    response.emit('data', Buffer.from('{"ok":true}'));
    response.emit('end');
  });
  return response;
}

test('local Admin client stays on HTTPS independently of the gateway setting', async () => {
  assert.equal(localAdminBase({ adminPort: 47831 } as any), 'https://localhost:47831');

  const captured: any[] = [];
  test.mock.method(https, 'request', (options: any, callback: any) => {
    captured.push(options);
    const request = new EventEmitter() as any;
    request.write = () => {};
    request.end = () => {};
    queueMicrotask(() => callback(responseDouble()));
    return request;
  });

  const response = await localAdminFetch({ adminPort: 47831 } as any, '/api/health');

  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"ok":true}');
  assert.equal(captured[0].port, 47831);
  assert.equal(captured[0].rejectUnauthorized, true);
  assert.equal(captured[0].servername, 'localhost');
});
