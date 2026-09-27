import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import type { CdpClient } from '../src/cdp-client.js';
import { CdpDriver } from '../src/cdp-driver.js';
import { captureViewport } from '../src/cdp-vision.js';
import { WebSocketServer } from './ws-test-server.js';

type Sent = Array<[string, any]>;

/** SOI, then a baseline SOF0 segment declaring 640x480, which is all a size probe reads. */
const JPEG_640x480 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02,
  0x80, 0x03,
]).toString('base64');

function fakeClient(viewport: { width: number; height: number } | null, sent: Sent = []) {
  return {
    async send(method: string, params: any) {
      sent.push([method, params]);
      if (method === 'Page.getLayoutMetrics') {
        if (!viewport) throw new Error('metrics unavailable');
        return {
          cssVisualViewport: {
            pageX: 0,
            pageY: 0,
            clientWidth: viewport.width,
            clientHeight: viewport.height,
          },
        };
      }
      return { data: JPEG_640x480 };
    },
  } as unknown as CdpClient;
}

function shots(sent: Sent) {
  return sent.filter(([method]) => method === 'Page.captureScreenshot').map(([, params]) => params);
}

test('the viewport is captured as a jpeg of the visible area only, never beyond it', async () => {
  const sent: Sent = [];
  const shot = await captureViewport(fakeClient({ width: 800, height: 600 }, sent));
  const [params] = shots(sent);
  assert.equal(params.format, 'jpeg');
  assert.equal(params.captureBeyondViewport, false);
  assert.equal(params.fromSurface, true);
  assert.deepEqual(params.clip, { x: 0, y: 0, width: 800, height: 600, scale: 1 });
  assert.equal(shot.devicePixelRatio, 1);
  assert.match(shot.imageDataUri, /^data:image\/jpeg;base64,/);
});

test('a large viewport is downscaled through the clip, and the ratio says by how much', async () => {
  const sent: Sent = [];
  const shot = await captureViewport(fakeClient({ width: 2560, height: 1440 }, sent));
  assert.equal(shots(sent)[0].clip.scale, 0.5);
  assert.equal(shot.devicePixelRatio, 0.5);
});

test('without layout metrics the capture still happens, unclipped and bounded', async () => {
  const sent: Sent = [];
  const shot = await captureViewport(fakeClient(null, sent));
  const [params] = shots(sent);
  assert.equal(params.clip, undefined);
  assert.equal(params.format, 'jpeg');
  assert.equal(shot.devicePixelRatio, 1);
  // With no metrics the only honest source of the size is the image itself.
  assert.equal(shot.imageWidth, 640);
  assert.equal(shot.imageHeight, 480);
  assert.deepEqual(shot.viewport, { width: 640, height: 480 });
});

test('coordinate click and drag after a downscaled capture land in CSS pixels', async () => {
  const mouse: Array<{ x: number; y: number }> = [];
  const socket = await WebSocketServer.start((message, reply) => {
    const request = JSON.parse(message) as { id: number; method: string; params?: any };
    const result = (() => {
      if (request.method === 'Page.getNavigationHistory') {
        return { currentIndex: 0, entries: [{ url: 'https://game.example/' }] };
      }
      if (request.method === 'Accessibility.getFullAXTree') return { nodes: [] };
      if (request.method === 'Page.getLayoutMetrics') {
        return {
          cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 2560, clientHeight: 1440 },
        };
      }
      if (request.method === 'Page.captureScreenshot') return { data: '/9j/AAAA' };
      if (request.method === 'Input.dispatchMouseEvent') mouse.push(request.params);
      return {};
    })();
    reply(JSON.stringify({ id: request.id, result }));
  });
  let control: Server | undefined;
  const driver = new CdpDriver();
  try {
    control = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify([
          {
            id: 'page-1',
            type: 'page',
            url: 'https://game.example/',
            title: '',
            webSocketDebuggerUrl: socket.url,
          },
        ]),
      );
    });
    await new Promise<void>((resolve) => control!.listen(0, '127.0.0.1', resolve));
    const port = (control.address() as { port: number }).port;
    await driver.connect({ transport: 'cdp', cdpPort: port });
    const snapshot = await driver.snapshot({ mode: 'vision', maxNodes: 50 });
    assert.equal(snapshot.devicePixelRatio, 0.5);
    assert.equal(snapshot.imageWidth, 1280);
    assert.equal(snapshot.imageHeight, 720);
    assert.deepEqual(snapshot.viewport, { width: 2560, height: 1440 });
    await driver.act([{ op: 'click', x: 640, y: 360 }], { stopOnError: true });
    assert.deepEqual(
      mouse.map(({ x, y }) => [x, y]),
      [
        [1280, 720],
        [1280, 720],
      ],
    );
    const dragged = await driver.act([{ op: 'drag', x: 10, y: 20, toX: 100, toY: 150 }], {
      stopOnError: true,
    });
    assert.deepEqual(dragged, [{ op: 'drag', ok: true }]);
    const dragEvents = mouse.slice(2) as Array<{
      type: string;
      x: number;
      y: number;
      buttons?: number;
    }>;
    assert.deepEqual(
      dragEvents.map(({ type, x, y }) => [type, x, y]).filter(([type]) => type !== 'mouseMoved'),
      [
        ['mousePressed', 20, 40],
        ['mouseReleased', 200, 300],
      ],
    );
    assert.ok(dragEvents.some((event) => event.type === 'mouseMoved' && event.buttons === 1));
  } finally {
    await driver.disconnect();
    await socket.stop();
    await new Promise<void>((resolve) => control?.close(() => resolve()) ?? resolve());
  }
});
