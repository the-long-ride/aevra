import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserExtensionPairing } from '../../protocol/src/browser.js';
import { ExtensionServer } from '../src/extension-server.js';
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

const LEGACY: BrowserExtensionPairing = {
  pairingId: `legacy-${SAMPLE_EXTENSION_ID}`,
  profileId: null,
  profileName: 'Legacy browser profile',
  extensionId: SAMPLE_EXTENSION_ID,
  credentialId: null,
  legacy: true,
} as BrowserExtensionPairing;

async function withServer(
  body: (server: ExtensionServer, join: () => Promise<RawClient>) => Promise<void>,
): Promise<void> {
  const server = new ExtensionServer({
    secret: SAMPLE_SECRET,
    extensionId: SAMPLE_EXTENSION_ID,
    epoch: () => 1,
  });
  const { port } = await server.start({ port: 0 });
  const clients: RawClient[] = [];
  const join = async () => {
    const client = await openRaw(port, [ORIGIN, KEY]);
    clients.push(client);
    client.send({ type: 'auth', token: sampleToken() });
    await until(() => client.messages.length > 0);
    return client;
  };
  try {
    await body(server, join);
  } finally {
    for (const client of clients) client.socket.destroy();
    await server.stop();
  }
}

async function commandId(client: RawClient, index = 0): Promise<string> {
  await until(() => client.messages.filter((message) => message.type === 'cmd').length > index);
  return client.messages.filter((message) => message.type === 'cmd')[index].id;
}

test('calls without a matching peer are refused with a code naming the cause', async () => {
  await withServer(async (server, join) => {
    assert.equal(server.peerId(), '');
    await assert.rejects(
      server.call('tabs'),
      (error: any) => error.code === 'BROWSER_UNAVAILABLE' && /not connected/.test(error.message),
    );
    await assert.rejects(
      server.call('tabs', {}, 100, 'ext_expected'),
      (error: any) => error.code === 'BROWSER_NOT_CONNECTED' && /not connected/.test(error.message),
    );
    await join();
    assert.match(server.peerId(), /^ext_/);
    await assert.rejects(
      server.call('tabs', {}, 100, 'ext_someone_else'),
      (error: any) =>
        error.code === 'BROWSER_NOT_CONNECTED' && /profile changed/.test(error.message),
    );
  });
});

test('a standby peer is ignored until it is promoted, then listeners learn of it', async () => {
  await withServer(async (server, join) => {
    const primary = await join();
    assert.deepEqual(primary.messages, [{ type: 'auth_ok' }]);
    const standby = await join();
    assert.deepEqual(standby.messages, [{ type: 'auth_standby' }]);
    const peers: unknown[] = [];
    server.on((name, payload) => {
      if (name === 'peer') peers.push(payload);
    });

    const pending = server.call('tabs', {}, 2000);
    const id = await commandId(primary);
    // The standby socket answering someone else's command must not resolve it.
    standby.send({ id, type: 'result', payload: 'from standby' });
    standby.send({ type: 'event', name: 'standby_event' });
    primary.send({ id, type: 'result', payload: 'from primary' });
    assert.equal(await pending, 'from primary');

    const firstPeer = server.peer();
    primary.socket.destroy();
    await until(() => server.peer() !== null && server.peer() !== firstPeer);
    await until(() => standby.messages.some((message) => message.type === 'auth_ok'));
    assert.equal(peers.length, 1);
    assert.equal((peers[0] as any).extensionId, SAMPLE_EXTENSION_ID);
  });
});

test('pruneStandby keeps allowed standby peers and ends revoked ones', async () => {
  await withServer(async (server, join) => {
    await join();
    const standby = await join();
    server.pruneStandby([LEGACY]);
    assert.equal(standby.isClosed(), false);
    assert.equal(server.activePairingStillAllowed([LEGACY]), true);
    assert.equal(server.activePairingStillAllowed([]), false);

    server.pruneStandby([]);
    await until(() => standby.isClosed());
    assert.deepEqual(standby.messages.at(-1), { type: 'auth_error', code: 'AUTH_REJECTED' });
    // The active peer is not pruned.
    assert.notEqual(server.peer(), null);
  });
});

test('dropPeer closes the active peer and every standby peer', async () => {
  await withServer(async (server, join) => {
    const primary = await join();
    const standby = await join();
    server.dropPeer();
    assert.equal(server.peer(), null);
    await until(() => primary.isClosed() && standby.isClosed());
    server.dropPeer();
    assert.equal(server.peer(), null);
  });
});

test('rejectPeer with no active peer is a no-op; with one it promotes the standby', async () => {
  await withServer(async (server, join) => {
    server.rejectPeer();
    assert.equal(server.peer(), null);
    const primary = await join();
    const standby = await join();
    const peers: string[] = [];
    server.on((name) => peers.push(name));
    server.rejectPeer();
    await until(() => primary.isClosed());
    assert.deepEqual(primary.messages.at(-1), { type: 'auth_error', code: 'AUTH_REJECTED' });
    await until(() => standby.messages.some((message) => message.type === 'auth_ok'));
    assert.deepEqual(peers, ['peer']);
    assert.notEqual(server.peer(), null);
  });
});

test('a non-snapshot call failed by disconnect carries no capture context', async () => {
  await withServer(async (server, join) => {
    const primary = await join();
    const pending = server.call('tabs', {}, 2000);
    await commandId(primary);
    primary.socket.destroy();
    await assert.rejects(
      pending,
      (error: any) =>
        error.code === 'BROWSER_UNAVAILABLE' &&
        error.message === 'BROWSER_UNAVAILABLE: The Aevra extension disconnected before replying',
    );
  });
});

test('stop fails calls still pending on a socket that was just dropped', async () => {
  const server = new ExtensionServer({
    secret: SAMPLE_SECRET,
    extensionId: SAMPLE_EXTENSION_ID,
    epoch: () => 1,
  });
  const { port } = await server.start({ port: 0 });
  const client = await openRaw(port, [ORIGIN, KEY]);
  try {
    client.send({ type: 'auth', token: sampleToken() });
    await until(() => server.peer() !== null);
    const snapshot = server.call('snapshot', { mode: 'vision' }, 2000);
    const tabs = server.call('tabs', {}, 2000);
    await commandId(client, 1);
    // dropPeer clears the active peer synchronously, while the socket's close
    // event (which would fail these calls) has not run yet.
    server.dropPeer();
    await server.stop();
    await assert.rejects(
      snapshot,
      (error: any) =>
        error.code === 'BROWSER_NOT_CONNECTED' &&
        /stopped \(close=server_stop, stage=command_sent\)$/.test(error.message),
    );
    await assert.rejects(
      tabs,
      (error: any) => error.message === 'BROWSER_NOT_CONNECTED: extension server stopped',
    );
  } finally {
    client.socket.destroy();
  }
});
