import assert from 'node:assert/strict';
import test from 'node:test';
import { CdpDriver } from '../src/cdp-driver.js';
import { captureViewport, scaledBoxes } from '../src/cdp-vision.js';
import { captureWithinBudget, MAX_VISION_IMAGE_CHARS } from '../src/vision-budget.js';
import { FakeCdp } from './fake-cdp.js';

/** A header-only JPEG: SOI, an APP0 and a DHT segment, then SOF0 with the size. */
function jpeg(width: number, height: number): string {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff];
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc4, 0x00, 0x04, 0x00, 0x00,
    ...sof,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]).toString('base64');
}

function stubClient(metrics: unknown, data: string) {
  const calls: Array<{ method: string; params: any }> = [];
  return {
    calls,
    client: {
      async send(method: string, params: any = {}) {
        calls.push({ method, params });
        if (method === 'Page.getLayoutMetrics') {
          if (metrics instanceof Error) throw metrics;
          return metrics;
        }
        return { data };
      },
    } as any,
  };
}

test('without layout metrics the unclipped JPEG reports its own size', async () => {
  const { client, calls } = stubClient(new Error('renderer crashed'), jpeg(320, 200));
  const capture = await captureViewport(client);
  assert.equal(capture.devicePixelRatio, 1);
  assert.deepEqual([capture.imageWidth, capture.imageHeight], [320, 200]);
  assert.deepEqual(capture.viewport, { width: 320, height: 200 });
  assert.equal(calls.at(-1)!.params.clip, undefined);
});

test('a zero-sized viewport falls back to the unclipped capture', async () => {
  const { client } = stubClient({ cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 0, clientHeight: 10 } }, jpeg(10, 10));
  assert.equal((await captureViewport(client)).imageWidth, 10);
  const { client: none } = stubClient({}, jpeg(12, 9));
  assert.equal((await captureViewport(none)).imageHeight, 9);
});

for (const [label, data] of [
  ['not a JPEG at all', Buffer.from('plain words').toString('base64')],
  ['a JPEG with a broken segment marker', Buffer.from([0xff, 0xd8, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64')],
  ['a JPEG without a frame header', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0]).toString('base64')],
] as const) {
  test(`an unclipped capture that is ${label} fails as BROWSER_CAPTURE_FAILED`, async () => {
    const { client } = stubClient(new Error('no metrics'), data);
    await assert.rejects(captureViewport(client), (error: any) => error.code === 'BROWSER_CAPTURE_FAILED');
  });
}

test('an unclipped capture over the transport budget is refused', async () => {
  const { client } = stubClient(new Error('no metrics'), 'A'.repeat(MAX_VISION_IMAGE_CHARS));
  await assert.rejects(captureViewport(client), (error: any) => error.code === 'BROWSER_CAPTURE_TOO_LARGE');
});

test('the layout viewport is used when the visual one is absent, clipped at the origin', async () => {
  const { client, calls } = stubClient({ cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } }, 'AAAA');
  const capture = await captureViewport(client);
  assert.deepEqual(capture.viewport, { width: 800, height: 600 });
  assert.deepEqual(calls.at(-1)!.params.clip, { x: 0, y: 0, width: 800, height: 600, scale: 1 });
});

test('the visual viewport offset is carried into the clip', async () => {
  const { client, calls } = stubClient(
    { cssVisualViewport: { pageX: 5, pageY: 40, clientWidth: 2560, clientHeight: 1280 } },
    'AAAA',
  );
  const capture = await captureViewport(client);
  assert.equal(capture.devicePixelRatio, 0.5);
  assert.deepEqual(calls.at(-1)!.params.clip, { x: 5, y: 40, width: 2560, height: 1280, scale: 0.5 });
});

test('a small viewport stops shrinking at the minimum edge instead of going smaller', async () => {
  const sizes: number[] = [];
  await assert.rejects(
    captureWithinBudget({ width: 500, height: 400 }, async (size) => {
      sizes.push(size.width);
      return 'A'.repeat(MAX_VISION_IMAGE_CHARS + 1);
    }),
    (error: any) => error.code === 'BROWSER_CAPTURE_TOO_LARGE',
  );
  // Two full-scale quality steps; 0.75 x 500 = 375 is under the 480 floor.
  assert.deepEqual(sizes, [500, 500]);
});

test('nodes whose box cannot be resolved are left unlabelled', async () => {
  const nodes = [
    { ref: 'ref_1_0', role: 'button', name: 'A' },
    { ref: 'ref_1_1', role: 'button', name: 'B' },
  ];
  const boxes = await scaledBoxes(
    nodes,
    async (index) => {
      if (index === 1) throw new Error('detached');
      return { x: 1, y: 2, width: 3, height: 4 };
    },
    2,
  );
  assert.deepEqual(boxes, [{ ref: 'ref_1_0', label: 'A', box: { x: 2, y: 4, width: 6, height: 8 } }]);
});

test('a CDP vision snapshot scales boxes and later coordinate clicks by the capture ratio', async () => {
  const fake = await FakeCdp.start([{ id: 'page-1' }]);
  const driver = new CdpDriver();
  try {
    fake.handlers['Accessibility.getFullAXTree'] = () => ({
      nodes: [
        { nodeId: '1', role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 11 },
        { nodeId: '2', role: { value: 'link' }, name: { value: 'Gone' }, backendDOMNodeId: 12 },
      ],
    });
    fake.handlers['DOM.describeNode'] = () => ({ node: { attributes: [] } });
    fake.handlers['Page.getLayoutMetrics'] = () => ({
      cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 2560, clientHeight: 1440 },
    });
    fake.handlers['Page.captureScreenshot'] = () => ({ data: 'AAAA' });
    fake.handlers['DOM.getBoxModel'] = ({ backendNodeId }) => {
      if (backendNodeId === 12) throw new Error('no box');
      return { model: { content: [100, 100, 300, 100, 300, 200, 100, 200], width: 200, height: 100 } };
    };
    await driver.connect({ transport: 'cdp', cdpPort: fake.port });
    const snapshot: any = await driver.snapshot({ mode: 'vision', maxNodes: 10 });
    assert.equal(snapshot.devicePixelRatio, 0.5);
    assert.deepEqual(snapshot.boxes, [{ ref: 'ref_1_0', label: 'Go', box: { x: 50, y: 50, width: 100, height: 50 } }]);
    await driver.act([{ op: 'click', x: 100, y: 60 }], { stopOnError: true });
    const pressed = fake.calls.find((call) => call.params?.type === 'mousePressed');
    assert.deepEqual([pressed!.params.x, pressed!.params.y], [200, 120]);
  } finally {
    await driver.disconnect();
    await fake.stop();
  }
});
