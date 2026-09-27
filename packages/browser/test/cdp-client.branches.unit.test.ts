import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { CdpClient } from '../src/cdp-client.js';
import { WebSocketServer } from './ws-test-server.js';

async function withClient(body: (client: CdpClient) => Promise<void>): Promise<void> {
  const server = await WebSocketServer.start((message, reply, push) => {
    const { id, method } = JSON.parse(message) as { id: number; method: string };
    if (method === 'fail') return reply(JSON.stringify({ id, error: {} }));
    if (method === 'empty') return reply(JSON.stringify({ id }));
    if (method === 'stray') {
      reply(JSON.stringify({ id: 9999, result: { wrong: true } }));
      reply('not json at all');
      return reply(JSON.stringify({ id, result: { right: true } }));
    }
    if (method === 'events') {
      push(
        JSON.stringify({
          method: 'Runtime.consoleAPICalled',
          params: { type: 'error', args: [{ value: 'a' }, { description: 'b' }, {}] },
        }),
      );
      push(JSON.stringify({ method: 'Runtime.consoleAPICalled' }));
      push(JSON.stringify({ method: 'Log.entryAdded' }));
      push(JSON.stringify({ method: 'Network.responseReceived' }));
      push(JSON.stringify({ method: 'Page.frameNavigated', params: {} }));
    }
    if (method === 'flood') {
      for (let index = 0; index < 505; index += 1) {
        push(
          JSON.stringify({
            method: 'Log.entryAdded',
            params: { entry: { text: `line ${index}` } },
          }),
        );
      }
    }
    if (method === 'silent') return;
    reply(JSON.stringify({ id, result: {} }));
  });
  const client = await CdpClient.connect(server.url);
  try {
    await body(client);
  } finally {
    await client.close();
    await server.stop();
  }
}

test('an error reply without a message rejects with a generic CDP error', async () => {
  await withClient(async (client) => {
    await assert.rejects(client.send('fail'), (error: any) => error.message === 'CDP error');
  });
});

test('a reply without a result resolves to an empty object', async () => {
  await withClient(async (client) => {
    assert.deepEqual(await client.send('empty'), {});
  });
});

test('replies for unknown ids and non-JSON frames are ignored', async () => {
  await withClient(async (client) => {
    assert.deepEqual(await client.send('stray'), { right: true });
  });
});

test('console and network events are recorded with defaults for missing fields', async () => {
  await withClient(async (client) => {
    await client.send('events');
    const logs = client.drain('console', 10).map(({ level, text }) => [level, text]);
    assert.deepEqual(logs, [
      ['error', 'a b '],
      ['log', ''],
      ['info', ''],
    ]);
    const network = client.drain('network', 10).map(({ text, url, status }) => [text, url, status]);
    assert.deepEqual(network, [['', '', 0]]);
    assert.equal(client.drain('console', 0).length, 1);
  });
});

test('the event buffer keeps only the most recent 500 entries', async () => {
  await withClient(async (client) => {
    await client.send('flood');
    const all = client.drain('console', 10_000);
    assert.equal(all.length, 500);
    assert.equal(all[0]!.text, 'line 5');
    assert.equal(all.at(-1)!.text, 'line 504');
  });
});

test('an unanswered request times out, and closing rejects what is still pending', async () => {
  await withClient(async (client) => {
    await assert.rejects(client.send('silent', {}, 20), /BROWSER_TIMEOUT: silent exceeded 20ms/);
    const pending = client.send('silent', {}, 5000);
    await client.close();
    await assert.rejects(pending, /BROWSER_NOT_CONNECTED: CDP socket closed/);
  });
});

test('connecting to a port with no listener fails as unavailable', async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  await assert.rejects(
    CdpClient.connect(`ws://127.0.0.1:${port}/devtools`),
    /BROWSER_UNAVAILABLE: CDP socket failed to open/,
  );
});
