import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { CdpDriver } from '../src/cdp-driver.js';
import { WebSocketServer } from './ws-test-server.js';

test('CdpDriver retries a transient ERR_ABORTED navigation', async () => {
  let navigateAttempts = 0;
  const socket = await WebSocketServer.start((message, reply) => {
    const request = JSON.parse(message) as { id: number; method: string };
    if (request.method === 'Page.navigate') {
      navigateAttempts += 1;
      reply(
        JSON.stringify(
          navigateAttempts === 1
            ? { id: request.id, result: { errorText: 'net::ERR_ABORTED' } }
            : { id: request.id, result: { frameId: 'frame' } },
        ),
      );
      return;
    }
    if (request.method === 'Page.getNavigationHistory') {
      reply(
        JSON.stringify({
          id: request.id,
          result: { currentIndex: 0, entries: [{ url: 'http://127.0.0.1:4321/' }] },
        }),
      );
      return;
    }
    reply(JSON.stringify({ id: request.id, result: {} }));
  });

  let control: Server | undefined;
  try {
    control = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify([
          {
            id: 'page-1',
            type: 'page',
            url: 'about:blank',
            title: '',
            webSocketDebuggerUrl: socket.url,
          },
        ]),
      );
    });
    await new Promise<void>((resolve) => control!.listen(0, '127.0.0.1', resolve));
    const port = (control.address() as { port: number }).port;
    const driver = new CdpDriver();
    try {
      await driver.connect({ transport: 'cdp', cdpPort: port });
      const result = await driver.navigate({
        url: 'http://127.0.0.1:4321/',
        waitUntil: 'load',
      });
      assert.equal(result.url, 'http://127.0.0.1:4321/');
      assert.equal(navigateAttempts, 2);
    } finally {
      await driver.disconnect();
    }
  } finally {
    await socket.stop();
    await new Promise<void>((resolve) => control?.close(() => resolve()) ?? resolve());
  }
});

test('CdpDriver pins an explicit tabId to that target without activating the initial tab', async () => {
  let firstNavigations = 0;
  let secondNavigations = 0;
  const first = await WebSocketServer.start((message, reply) => {
    const request = JSON.parse(message) as { id: number; method: string };
    if (request.method === 'Page.navigate') firstNavigations += 1;
    if (request.method === 'Page.getNavigationHistory') {
      reply(
        JSON.stringify({
          id: request.id,
          result: { currentIndex: 0, entries: [{ url: 'https://first.example/' }] },
        }),
      );
      return;
    }
    reply(JSON.stringify({ id: request.id, result: { frameId: 'first-frame' } }));
  });
  const second = await WebSocketServer.start((message, reply) => {
    const request = JSON.parse(message) as { id: number; method: string };
    if (request.method === 'Page.navigate') secondNavigations += 1;
    if (request.method === 'Page.getNavigationHistory') {
      reply(
        JSON.stringify({
          id: request.id,
          result: { currentIndex: 0, entries: [{ url: 'https://second.example/next' }] },
        }),
      );
      return;
    }
    reply(JSON.stringify({ id: request.id, result: { frameId: 'second-frame' } }));
  });

  let control: Server | undefined;
  try {
    control = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify([
          {
            id: 'page-1',
            type: 'page',
            url: 'https://first.example/',
            title: 'First',
            webSocketDebuggerUrl: first.url,
          },
          {
            id: 'page-2',
            type: 'page',
            url: 'https://second.example/',
            title: 'Second',
            webSocketDebuggerUrl: second.url,
          },
        ]),
      );
    });
    await new Promise<void>((resolve) => control!.listen(0, '127.0.0.1', resolve));
    const port = (control.address() as { port: number }).port;
    const driver = new CdpDriver();
    try {
      await driver.connect({ transport: 'cdp', cdpPort: port, tabId: 'page-1' });
      const result = await driver.navigate({
        tabId: 'page-2',
        url: 'https://second.example/next',
        waitUntil: 'load',
      });
      assert.equal(result.tabId, 'page-2');
      assert.equal(firstNavigations, 0);
      assert.equal(secondNavigations, 1);
      const tabs = await driver.tabs({ action: 'list' });
      assert.equal(tabs.find((tab) => tab.tabId === 'page-1')?.active, true);
    } finally {
      await driver.disconnect();
    }
  } finally {
    await first.stop();
    await second.stop();
    await new Promise<void>((resolve) => control?.close(() => resolve()) ?? resolve());
  }
});
