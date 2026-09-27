import assert from 'node:assert/strict';
import test from 'node:test';
import { mintExtensionToken } from '../../security/src/extension-token.js';
import { ExtensionServer } from '../src/extension-server.js';
import { MAX_FRAME_BYTES } from '../src/ws-server.js';
import { connectFakeExtension } from './fake-extension.js';

const secret = Buffer.from('d'.repeat(64), 'hex');
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';

async function paired() {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  const token = mintExtensionToken(secret, {
    extensionId,
    epoch: 1,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const peer = await connectFakeExtension(address.url, extensionId, { token });
  const deadline = Date.now() + 2000;
  while (!server.peer() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { server, peer, address, token };
}

async function commandAt(peer: { received: any[] }, index: number): Promise<any> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const command = peer.received.filter((frame) => frame.type === 'cmd')[index];
    if (command) return command;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`extension did not receive command ${index + 1}`);
}

// The reported bug: a canvas game's PNG crossed the frame cap, the socket was
// dropped, and the caller learned nothing until the full RPC budget ran out.
test('an oversized reply fails the call immediately with a specific code', async () => {
  const { server, peer } = await paired();
  try {
    peer.onCommand(() => ({ imageDataUri: 'A'.repeat(MAX_FRAME_BYTES + 1024) }));
    const started = Date.now();
    await assert.rejects(
      server.call('snapshot', {}, 10_000),
      (error: any) => error.code === 'BROWSER_REPLY_TOO_LARGE',
    );
    assert.ok(Date.now() - started < 5000, 'expected the failure well before the RPC budget');
  } finally {
    await server.stop();
  }
});

test('a fragmented masked vision reply is reassembled before JSON parsing', async () => {
  const { server, peer } = await paired();
  try {
    const imageDataUri = `data:image/jpeg;base64,${'A'.repeat(180_000)}`;
    peer.onCommandRaw((command) => {
      peer.send({
        type: 'capture_progress',
        id: command.id,
        stage: 'reply_send_attempt',
        elapsedMs: 5,
      });
      peer.sendFragmented({ id: command.id, type: 'result', payload: { imageDataUri } }, 65_000);
      return undefined;
    });
    assert.deepEqual(await server.call('snapshot', { mode: 'vision' }, 1000), { imageDataUri });
  } finally {
    await server.stop();
  }
});

test('fragmentation cannot bypass the reply size limit', async () => {
  const { server, peer } = await paired();
  try {
    peer.onCommandRaw((command) => {
      peer.sendFragmented(
        { id: command.id, type: 'result', payload: { imageDataUri: 'A'.repeat(MAX_FRAME_BYTES) } },
        300_000,
      );
      return undefined;
    });
    await assert.rejects(
      server.call('snapshot', { mode: 'vision' }, 1000),
      (error: any) => error.code === 'BROWSER_REPLY_TOO_LARGE',
    );
  } finally {
    await server.stop();
  }
});

// The extension probes with a plain request before dialling, because Chrome
// logs a refused WebSocket as an error it cannot catch. The probe needs an
// answer, not a request left hanging.
test('a plain http request is answered at once with 426 and no body', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  try {
    const response = await fetch(`http://${address.host}:${address.port}/`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 426);
    assert.equal(response.headers.get('upgrade'), 'websocket');
    assert.equal(await response.text(), '');
  } finally {
    await server.stop();
  }
});

test('a peer that disconnects mid-call fails the call instead of timing out', async () => {
  const { server, peer } = await paired();
  try {
    peer.onCommand(() => {
      peer.destroy();
      return undefined;
    });
    const started = Date.now();
    await assert.rejects(
      server.call('snapshot', {}, 10_000),
      (error: any) => error.code === 'BROWSER_UNAVAILABLE',
    );
    assert.ok(Date.now() - started < 5000, 'expected the failure well before the RPC budget');
  } finally {
    await server.stop();
  }
});

test('snapshot disconnect reports the last capture stage and remote close cause', async () => {
  const { server, peer } = await paired();
  try {
    peer.onCommandRaw((command) => {
      peer.send({
        type: 'capture_progress',
        id: command.id,
        stage: 'capture_api_done',
        elapsedMs: 7,
        bytes: 800,
      });
      setTimeout(() => peer.destroy(), 10);
      return undefined;
    });
    await assert.rejects(
      server.call('snapshot', { mode: 'vision' }, 1000),
      (error: any) =>
        error.code === 'BROWSER_UNAVAILABLE' &&
        /close=remote_close, stage=capture_api_done/.test(error.message),
    );
  } finally {
    await server.stop();
  }
});

test('accessibility snapshots ignore vision progress frames', async () => {
  const { server, peer } = await paired();
  try {
    peer.onCommandRaw((command) => {
      peer.send({ type: 'capture_progress', id: command.id, stage: 'encode_done', elapsedMs: 2 });
      setTimeout(() => peer.destroy(), 10);
      return undefined;
    });
    await assert.rejects(server.call('snapshot', { mode: 'a11y' }, 1000), (error: any) =>
      /stage=command_sent/.test(error.message),
    );
  } finally {
    await server.stop();
  }
});

test('a second peer remains in standby and takes over after the active peer closes', async () => {
  const { server, peer, address, token } = await paired();
  try {
    const activePeer = server.peer();
    peer.onCommandRaw(() => undefined);
    const pending = server.call('snapshot', { mode: 'vision' }, 1000);
    const replacement = await connectFakeExtension(address.url, extensionId, { token });
    replacement.onCommand(() => ({ ok: true }));
    assert.equal(server.peer(), activePeer);
    peer.destroy();
    await assert.rejects(
      pending,
      (error: any) =>
        error.code === 'BROWSER_UNAVAILABLE' && /close=remote_close/.test(error.message),
    );
    assert.deepEqual(await server.call('tabs', {}, 1000), { ok: true });
  } finally {
    await server.stop();
  }
});

test('wrong and late progress frames cannot change another snapshot stage', async () => {
  const { server, peer } = await paired();
  try {
    peer.onCommandRaw(() => undefined);
    await assert.rejects(
      server.call('snapshot', {}, 40),
      (error: any) => error.code === 'BROWSER_TIMEOUT',
    );
    const firstId = (await commandAt(peer, 0)).id;
    const pending = server.call('snapshot', {}, 1000);
    const secondId = (await commandAt(peer, 1)).id;
    assert.notEqual(secondId, firstId);
    peer.send({ type: 'capture_progress', id: firstId, stage: 'encode_done', elapsedMs: 9 });
    peer.send({ type: 'capture_progress', id: 'unknown', stage: 'encode_done', elapsedMs: 9 });
    peer.send({ type: 'capture_progress', id: secondId, stage: 'made_up', elapsedMs: 9 });
    setTimeout(() => peer.destroy(), 10);
    await assert.rejects(
      pending,
      (error: any) =>
        error.code === 'BROWSER_UNAVAILABLE' && /stage=command_sent/.test(error.message),
    );
  } finally {
    await server.stop();
  }
});

test('an unauthenticated peer cannot change a pending snapshot stage', async () => {
  const { server, peer, address } = await paired();
  try {
    peer.onCommandRaw(() => undefined);
    const pending = server.call('snapshot', { mode: 'vision' }, 1000);
    const command = await commandAt(peer, 0);
    const intruder = await connectFakeExtension(address.url, extensionId, { skipAuth: true });
    intruder.send({ type: 'capture_progress', id: command.id, stage: 'encode_done', elapsedMs: 1 });
    assert.equal(await intruder.closedWithin(500), true);
    peer.destroy();
    await assert.rejects(
      pending,
      (error: any) =>
        error.code === 'BROWSER_UNAVAILABLE' && /stage=command_sent/.test(error.message),
    );
  } finally {
    await server.stop();
  }
});

test('a timed-out snapshot leaves the authenticated socket usable', async () => {
  const { server, peer } = await paired();
  try {
    const identity = server.peer();
    peer.onCommand(({ op }) => (op === 'snapshot' ? new Promise(() => {}) : { ok: true }));
    await assert.rejects(
      server.call('snapshot', {}, 50),
      (error: any) => error.code === 'BROWSER_TIMEOUT',
    );
    assert.equal(server.peer(), identity);
    assert.deepEqual(await server.call('tabs', {}, 1000), { ok: true });
  } finally {
    await server.stop();
  }
});

test('a vision timeout reports its last capture stage without dropping the socket', async () => {
  const { server, peer } = await paired();
  try {
    const identity = server.peer();
    peer.onCommandRaw((command) => {
      peer.send({
        type: 'capture_progress',
        id: command.id,
        stage: 'capture_api_done',
        elapsedMs: 3,
      });
      return undefined;
    });
    await assert.rejects(
      server.call('snapshot', { mode: 'vision' }, 50),
      (error: any) =>
        error.code === 'BROWSER_TIMEOUT' && /stage=capture_api_done/.test(error.message),
    );
    assert.equal(server.peer(), identity);
  } finally {
    await server.stop();
  }
});

test('server stop identifies the local close cause for a pending snapshot', async () => {
  const { server, peer } = await paired();
  peer.onCommandRaw(() => undefined);
  const pending = server.call('snapshot', { mode: 'vision' }, 1000);
  await server.stop();
  await assert.rejects(pending, (error: any) =>
    /close=server_stop, stage=command_sent/.test(error.message),
  );
});

test('pairing revocation retains its specific message and capture stage', async () => {
  const { server, peer } = await paired();
  try {
    peer.onCommandRaw(() => undefined);
    const pending = server.call('snapshot', { mode: 'vision' }, 1000);
    server.rejectPeer();
    await assert.rejects(
      pending,
      (error: any) =>
        error.code === 'BROWSER_UNAVAILABLE' &&
        /pairing was revoked/.test(error.message) &&
        /close=pairing_revoked, stage=command_sent/.test(error.message),
    );
  } finally {
    await server.stop();
  }
});
