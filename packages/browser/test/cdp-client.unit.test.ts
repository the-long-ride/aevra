import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocketServer } from './ws-test-server.js';
import { CdpClient } from '../src/cdp-client.js';

test('CdpClient correlates responses by id', async () => {
  const server = await WebSocketServer.start((message, reply) => {
    const request = JSON.parse(message) as { id: number; method: string };
    reply(JSON.stringify({ id: request.id, result: { echoed: request.method } }));
  });
  try {
    const client = await CdpClient.connect(server.url);
    const first = client.send('Page.enable', {});
    const second = client.send('DOM.enable', {});
    assert.deepEqual(await first, { echoed: 'Page.enable' });
    assert.deepEqual(await second, { echoed: 'DOM.enable' });
    await client.close();
  } finally {
    await server.stop();
  }
});

test('CdpClient rejects on a CDP error payload', async () => {
  const server = await WebSocketServer.start((message, reply) => {
    const request = JSON.parse(message) as { id: number };
    reply(JSON.stringify({ id: request.id, error: { code: -32000, message: 'boom' } }));
  });
  try {
    const client = await CdpClient.connect(server.url);
    await assert.rejects(() => client.send('Page.navigate', {}), /boom/);
    await client.close();
  } finally {
    await server.stop();
  }
});

test('CdpClient buffers console events and drains them newest-last', async () => {
  const server = await WebSocketServer.start((message, reply, push) => {
    const request = JSON.parse(message) as { id: number };
    reply(JSON.stringify({ id: request.id, result: {} }));
    push(
      JSON.stringify({
        method: 'Runtime.consoleAPICalled',
        params: { type: 'log', args: [{ value: 'hello' }] },
      }),
    );
  });
  try {
    const client = await CdpClient.connect(server.url);
    await client.send('Runtime.enable', {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    const entries = client.drain('console', 10);
    assert.equal(entries.at(-1)?.text, 'hello');
    await client.close();
  } finally {
    await server.stop();
  }
});

test('CdpClient buffers Log.entryAdded and network responses separately', async () => {
  const server = await WebSocketServer.start((message, reply, push) => {
    const request = JSON.parse(message) as { id: number };
    reply(JSON.stringify({ id: request.id, result: {} }));
    push(
      JSON.stringify({
        method: 'Log.entryAdded',
        params: { entry: { level: 'warning', text: 'deprecated api' } },
      }),
    );
    push(
      JSON.stringify({
        method: 'Network.responseReceived',
        params: { response: { url: 'https://example.com/data', status: 204 } },
      }),
    );
  });
  try {
    const client = await CdpClient.connect(server.url);
    await client.send('Log.enable', {});
    await new Promise((resolve) => setTimeout(resolve, 80));

    const console = client.drain('console', 10);
    assert.equal(console.at(-1)?.level, 'warning');
    assert.equal(console.at(-1)?.text, 'deprecated api');

    const network = client.drain('network', 10);
    assert.equal(network.at(-1)?.status, 204);
    assert.equal(network.at(-1)?.url, 'https://example.com/data');
    await client.close();
  } finally {
    await server.stop();
  }
});

test('a message that is not JSON is ignored rather than throwing', async () => {
  const server = await WebSocketServer.start((message, reply, push) => {
    const request = JSON.parse(message) as { id: number };
    push('this is not json');
    reply(JSON.stringify({ id: request.id, result: { fine: true } }));
  });
  try {
    const client = await CdpClient.connect(server.url);
    assert.deepEqual(await client.send('Page.enable', {}), { fine: true });
    await client.close();
  } finally {
    await server.stop();
  }
});

test('a response with no matching request is dropped', async () => {
  const server = await WebSocketServer.start((message, reply) => {
    const request = JSON.parse(message) as { id: number };
    reply(JSON.stringify({ id: 9999, result: { stray: true } }));
    reply(JSON.stringify({ id: request.id, result: { real: true } }));
  });
  try {
    const client = await CdpClient.connect(server.url);
    assert.deepEqual(await client.send('Page.enable', {}), { real: true });
    await client.close();
  } finally {
    await server.stop();
  }
});

test('a closing socket rejects every in-flight request', async () => {
  const server = await WebSocketServer.start(() => undefined);
  const client = await CdpClient.connect(server.url);
  const pending = client.send('Page.navigate', {}, 5000);
  await server.stop();
  await assert.rejects(() => pending, /BROWSER_NOT_CONNECTED/);
});

test('connecting to a closed port fails rather than hanging', async () => {
  await assert.rejects(
    () => CdpClient.connect('ws://127.0.0.1:1/devtools', 2000),
    /BROWSER_UNAVAILABLE|BROWSER_TIMEOUT/,
  );
});

test('a request that is never answered times out', async () => {
  const server = await WebSocketServer.start(() => undefined);
  try {
    const client = await CdpClient.connect(server.url);
    await assert.rejects(() => client.send('Page.enable', {}, 150), /BROWSER_TIMEOUT/);
    await client.close();
  } finally {
    await server.stop();
  }
});
