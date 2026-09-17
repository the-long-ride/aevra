import assert from 'node:assert/strict';
import test from 'node:test';
import { mintExtensionToken } from '../../security/src/extension-token.js';
import { ExtensionServer } from '../src/extension-server.js';
import { connectFakeExtension } from './fake-extension.js';

const secret = Buffer.from('c'.repeat(64), 'hex');
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';

function validToken(epoch = 1): string {
  return mintExtensionToken(secret, {
    extensionId,
    epoch,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

test('the listener binds loopback only', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  try {
    assert.equal(address.host, '127.0.0.1');
  } finally {
    await server.stop();
  }
});

test('a socket that sends no auth frame is closed', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1, authTimeoutMs: 200 });
  const address = await server.start({ port: 0 });
  try {
    const peer = await connectFakeExtension(address.url, extensionId, { skipAuth: true });
    assert.equal(await peer.closedWithin(1500), true);
  } finally {
    await server.stop();
  }
});

test('a token from a revoked epoch is rejected', async () => {
  let epoch = 1;
  const server = new ExtensionServer({ secret, extensionId, epoch: () => epoch });
  const address = await server.start({ port: 0 });
  try {
    const token = validToken(1);
    epoch = 2;
    const peer = await connectFakeExtension(address.url, extensionId, { token });
    assert.equal(await peer.closedWithin(1500), true);
  } finally {
    await server.stop();
  }
});

test('a valid token from a different extension id is rejected by the origin pin', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  try {
    const peer = await connectFakeExtension(address.url, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', {
      token: validToken(),
    });
    assert.equal(await peer.closedWithin(1500), true);
  } finally {
    await server.stop();
  }
});

test('a valid peer is accepted and can answer a command', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  try {
    const peer = await connectFakeExtension(address.url, extensionId, { token: validToken() });
    peer.onCommand(() => ({
      tabs: [{ tabId: 't1', url: 'https://example.com', title: 'x', active: true }],
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = await server.call('tabs', { action: 'list' }, 2000);
    assert.equal((result as any).tabs[0].tabId, 't1');
  } finally {
    await server.stop();
  }
});

test('a command with no answer rejects with BROWSER_TIMEOUT', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  try {
    const peer = await connectFakeExtension(address.url, extensionId, { token: validToken() });
    peer.onCommand(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assert.rejects(() => server.call('snapshot', {}, 200), /BROWSER_TIMEOUT/);
  } finally {
    await server.stop();
  }
});

test('a second authenticated peer replaces the first', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  try {
    const first = await connectFakeExtension(address.url, extensionId, { token: validToken() });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const firstId = server.peer();
    assert.ok(firstId);

    const second = await connectFakeExtension(address.url, extensionId, { token: validToken() });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.notEqual(server.peer(), firstId);
    assert.equal(await first.closedWithin(1000), true);
    second.destroy();
  } finally {
    await server.stop();
  }
});

test('an event frame from the peer reaches registered listeners', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  const seen: Array<[string, unknown]> = [];
  const off = server.on((name, payload) => void seen.push([name, payload]));
  try {
    const peer = await connectFakeExtension(address.url, extensionId, { token: validToken() });
    await new Promise((resolve) => setTimeout(resolve, 100));
    peer.send({ type: 'event', name: 'tab.updated', payload: { tabId: 't1' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(seen.some(([name]) => name === 'tab.updated'));
    off();
    peer.destroy();
  } finally {
    await server.stop();
  }
});

test('a peer sending a malformed frame is dropped', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  try {
    const peer = await connectFakeExtension(address.url, extensionId, { token: validToken() });
    await new Promise((resolve) => setTimeout(resolve, 100));
    peer.sendRaw('not json at all');
    assert.equal(await peer.closedWithin(1000), true);
  } finally {
    await server.stop();
  }
});

test('an error frame rejects the matching call with its code', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  try {
    const peer = await connectFakeExtension(address.url, extensionId, { token: validToken() });
    peer.onCommandRaw((command) => ({
      id: command.id,
      type: 'error',
      payload: { code: 'BROWSER_REF_STALE', message: 'gone' },
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assert.rejects(() => server.call('act', {}, 2000), /gone/);
    peer.destroy();
  } finally {
    await server.stop();
  }
});

test('calling with no peer connected fails fast rather than hanging', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  await server.start({ port: 0 });
  try {
    await assert.rejects(() => server.call('tabs', {}, 500), /not connected/);
  } finally {
    await server.stop();
  }
});
