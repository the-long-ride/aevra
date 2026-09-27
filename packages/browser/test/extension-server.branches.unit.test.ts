import assert from 'node:assert/strict';
import test from 'node:test';
import { ExtensionServer } from '../src/extension-server.js';
import { acceptKey } from '../src/ws-server.js';
import {
  KEY,
  openRaw,
  ORIGIN,
  SAMPLE_EXTENSION_ID,
  SAMPLE_SECRET,
  sampleToken,
  until,
  type RawClient,
} from './raw-ws-client.js';

function newServer() {
  return new ExtensionServer({
    secret: SAMPLE_SECRET,
    extensionId: SAMPLE_EXTENSION_ID,
    epoch: () => 1,
  });
}

async function withServer(
  body: (server: ExtensionServer, port: number, clients: RawClient[]) => Promise<void>,
): Promise<void> {
  const server = newServer();
  const { port } = await server.start({ port: 0 });
  const clients: RawClient[] = [];
  try {
    await body(server, port, clients);
  } finally {
    for (const client of clients) client.socket.destroy();
    await server.stop();
  }
}

async function authed(
  server: ExtensionServer,
  port: number,
  clients: RawClient[],
  extra: Record<string, unknown> = {},
): Promise<RawClient> {
  const client = await openRaw(port, [ORIGIN, KEY]);
  clients.push(client);
  client.send({ type: 'auth', token: sampleToken(), ...extra });
  await until(() => client.messages.length > 0);
  return client;
}

test('a started server refuses a second start, and stop is idempotent', async () => {
  const server = newServer();
  await server.stop();
  await server.start({ port: 0 });
  await assert.rejects(server.start({ port: 0 }), /already listening/);
  await server.stop();
  await server.stop();
  assert.equal(server.peer(), null);
});

test('an upgrade without an extension origin is dropped before the handshake', async () => {
  await withServer(async (_server, port, clients) => {
    const missing = await openRaw(port, [KEY]);
    const webPage = await openRaw(port, ['Origin: https://example.com', KEY]);
    clients.push(missing, webPage);
    await until(() => missing.isClosed() && webPage.isClosed());
    assert.equal(missing.head, '');
    assert.equal(webPage.head, '');
  });
});

test('an upgrade without a key still gets the accept value computed for an empty key', async () => {
  await withServer(async (_server, port, clients) => {
    const client = await openRaw(port, [ORIGIN]);
    clients.push(client);
    assert.match(client.head, /^HTTP\/1\.1 101 /);
    assert.ok(client.head.includes(`Sec-WebSocket-Accept: ${acceptKey('')}`));
  });
});

test('an auth frame without a token is rejected and closed', async () => {
  await withServer(async (server, port, clients) => {
    const client = await openRaw(port, [ORIGIN, KEY]);
    clients.push(client);
    client.send({ type: 'auth' });
    await until(() => client.isClosed());
    assert.deepEqual(client.messages, [{ type: 'auth_error', code: 'AUTH_REJECTED' }]);
    assert.equal(server.peer(), null);
  });
});

test('a presented profile name is trimmed and bounded; a blank one falls back', async () => {
  await withServer(async (server, port, clients) => {
    const named = await authed(server, port, clients, {
      profileName: `  Work ${'x'.repeat(200)} `,
    });
    assert.deepEqual(named.messages, [{ type: 'auth_ok' }]);
    const profile = server.activeProfile();
    assert.equal(profile?.profileName.length, 120);
    assert.ok(profile?.profileName.startsWith('Work x'));
    named.socket.destroy();
    await until(() => server.peer() === null);
    await authed(server, port, clients, { profileName: '   ' });
    assert.equal(server.activeProfile()?.profileName, 'Legacy browser profile');
  });
});

test('a close frame from the peer ends the session', async () => {
  await withServer(async (server, port, clients) => {
    const client = await authed(server, port, clients);
    assert.notEqual(server.peer(), null);
    client.frame(0x88, '');
    await until(() => client.isClosed() && server.peer() === null);
    assert.equal(server.peerId(), '');
  });
});

test('a new text frame while a fragmented message is open is a protocol error', async () => {
  await withServer(async (server, port, clients) => {
    const client = await authed(server, port, clients);
    client.frame(0x01, '{"type":');
    client.frame(0x81, '{}');
    await until(() => client.isClosed() && server.peer() === null);
  });
});

test('a continuation frame with nothing to continue is a protocol error', async () => {
  await withServer(async (server, port, clients) => {
    const client = await authed(server, port, clients);
    client.frame(0x80, '{}');
    await until(() => client.isClosed() && server.peer() === null);
  });
});

test('a reply split over three fragments with a ping between them is reassembled', async () => {
  await withServer(async (server, port, clients) => {
    const client = await authed(server, port, clients);
    const pending = server.call('tabs', {}, 2000);
    await until(() => client.messages.some((message) => message.type === 'cmd'));
    const id = client.messages.find((message) => message.type === 'cmd').id;
    const json = JSON.stringify({ id, type: 'result', payload: { tabs: ['one'] } });
    client.frame(0x01, json.slice(0, 5));
    client.frame(0x89, '');
    client.frame(0x00, json.slice(5, 12));
    client.frame(0x80, json.slice(12));
    assert.deepEqual(await pending, { tabs: ['one'] });
  });
});

test('events reach listeners until they unsubscribe; unnamed events get an empty name', async () => {
  await withServer(async (server, port, clients) => {
    const seen: Array<[string, unknown]> = [];
    const off = server.on((name, payload) => seen.push([name, payload]));
    const client = await authed(server, port, clients);
    client.send({ type: 'event', name: 'tab_closed', payload: { tabId: '3' } });
    client.send({ type: 'event' });
    await until(() => seen.length >= 3);
    assert.deepEqual(seen.slice(1), [
      ['tab_closed', { tabId: '3' }],
      ['', undefined],
    ]);
    assert.equal(seen[0]![0], 'peer');
    off();
    const later: string[] = [];
    server.on((name) => later.push(name));
    client.send({ type: 'event', name: 'late' });
    client.send({ type: 'event', name: 'marker' });
    await until(() => later.includes('marker'));
    assert.equal(seen.length, 3);
  });
});

test('frames without an id or with an unknown type leave a call pending', async () => {
  await withServer(async (server, port, clients) => {
    const client = await authed(server, port, clients);
    const pending = server.call('tabs', {}, 2000);
    await until(() => client.messages.some((message) => message.type === 'cmd'));
    const id = client.messages.find((message) => message.type === 'cmd').id;
    client.send({ type: 'result', payload: 'no id' });
    client.send({ id, type: 'hello', payload: 'wrong type' });
    client.send({ id, type: 'error' });
    await assert.rejects(
      pending,
      (error: any) =>
        error.code === 'BROWSER_UNAVAILABLE' && error.message === 'extension command failed',
    );
  });
});

test('an error reply carries the extension code and message', async () => {
  await withServer(async (server, port, clients) => {
    const client = await authed(server, port, clients);
    const pending = server.call('act', {}, 2000);
    await until(() => client.messages.some((message) => message.type === 'cmd'));
    const id = client.messages.find((message) => message.type === 'cmd').id;
    client.send({ id, type: 'error', payload: { code: 'NOT_FOUND', message: 'tab gone' } });
    await assert.rejects(
      pending,
      (error: any) => error.code === 'NOT_FOUND' && error.message === 'tab gone',
    );
  });
});

test('out-of-order or malformed capture progress never moves the recorded stage', async () => {
  await withServer(async (server, port, clients) => {
    const seen: string[] = [];
    server.on((name) => seen.push(name));
    const client = await authed(server, port, clients);
    const pending = server.call('snapshot', { mode: 'vision' }, 5000);
    await until(() => client.messages.some((message) => message.type === 'cmd'));
    const id = client.messages.find((message) => message.type === 'cmd').id;
    const progress = (extra: Record<string, unknown>) =>
      client.send({ type: 'capture_progress', id, ...extra });
    progress({ stage: 'capture_api_done', elapsedMs: 4, bytes: 10 });
    progress({ stage: 'capture_started', elapsedMs: 5 });
    progress({ stage: 'encode_done', elapsedMs: 1.5 });
    progress({ stage: 'encode_done', elapsedMs: -1 });
    progress({ stage: 'encode_done', elapsedMs: 200_000 });
    progress({ stage: 'encode_done', elapsedMs: 6, bytes: 1.5 });
    progress({ stage: 'encode_done', elapsedMs: 6, bytes: -2 });
    progress({ stage: 'encode_done', elapsedMs: 6, bytes: 2_000_000_000 });
    client.send({ type: 'event', name: 'marker' });
    await until(() => seen.includes('marker'));
    client.socket.destroy();
    await assert.rejects(pending, (error: any) =>
      /close=remote_close, stage=capture_api_done/.test(error.message),
    );
  });
});
