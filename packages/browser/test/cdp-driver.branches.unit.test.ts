import assert from 'node:assert/strict';
import test from 'node:test';
import { CdpDriver } from '../src/cdp-driver.js';
import { FakeCdp, type FakePageSpec } from './fake-cdp.js';

async function withCdp(
  pages: FakePageSpec[],
  body: (fake: FakeCdp, driver: CdpDriver) => Promise<void>,
  connectTab?: string,
): Promise<void> {
  const fake = await FakeCdp.start(pages);
  const driver = new CdpDriver();
  try {
    installPage(fake);
    await driver.connect({ transport: 'cdp', cdpPort: fake.port, tabId: connectTab });
    await body(fake, driver);
  } finally {
    await driver.disconnect();
    await fake.stop();
  }
}

const BACKEND_ATTRIBUTES: Record<number, string[] | undefined> = {
  15: ['type', 'text'],
  16: ['type', 'password'],
};

/** One fixed page: a disabled button, a text box, a password box, and a link. */
function installPage(fake: FakeCdp): void {
  fake.handlers['Accessibility.getFullAXTree'] = () => ({
    nodes: [
      {
        nodeId: '1',
        role: { value: 'button' },
        name: { value: ' Save ' },
        backendDOMNodeId: 11,
        properties: [{ name: 'disabled' }],
      },
      { nodeId: '2', ignored: true, role: { value: 'button' }, backendDOMNodeId: 12 },
      { nodeId: '3' },
      { nodeId: '4', role: { value: 'textbox' } },
      { nodeId: '5', role: { value: 'textbox' }, value: { value: 42 }, backendDOMNodeId: 15 },
      {
        nodeId: '6',
        role: { value: 'textbox' },
        name: { value: 'Password' },
        backendDOMNodeId: 16,
      },
      { nodeId: '7', role: { value: 'link' }, name: { value: 'More' }, backendDOMNodeId: 17 },
    ],
  });
  fake.handlers['DOM.getDocument'] = () => ({ root: { nodeId: 1 } });
  fake.handlers['DOM.querySelector'] = ({ selector }) => {
    if (selector === 'bad[') throw new Error('DOM Error while querying');
    return { nodeId: selector === '#go' ? 5 : selector === '#ghost' ? 9 : 0 };
  };
  fake.handlers['DOM.describeNode'] = ({ nodeId, backendNodeId }) => {
    if (nodeId === 5) return { node: { backendNodeId: 21 } };
    if (nodeId === 9) return { node: {} };
    if (backendNodeId === 17) throw new Error('node detached');
    const attributes = BACKEND_ATTRIBUTES[backendNodeId];
    return { node: attributes ? { attributes } : {} };
  };
  fake.handlers['DOM.getBoxModel'] = () => ({
    model: { content: [10, 10, 30, 10, 30, 50, 10, 50], width: 20, height: 40 },
  });
  fake.handlers['DOM.getOuterHTML'] = ({ backendNodeId }) => ({
    outerHTML:
      backendNodeId === 11
        ? '<b>Ready</b>'
        : '<body><p>Whole   page</p><script>x()</script></body>',
  });
  fake.handlers['Input.dispatchKeyEvent'] = ({ key }) => {
    if (key === 'F13') throw new Error('Input failed');
    return {};
  };
}

const mouse = (fake: FakeCdp) =>
  fake.calls
    .filter((call) => call.method === 'Input.dispatchMouseEvent')
    .map((call) => call.params);

test('calls before connect are refused as not connected', async () => {
  await assert.rejects(
    new CdpDriver().tabs({ action: 'list' }),
    (error: any) => error.code === 'BROWSER_NOT_CONNECTED',
  );
});

test('a failing target list, a missing tab and a socketless target all refuse to connect', async () => {
  const fake = await FakeCdp.start([{ id: 'bare', noSocket: true }]);
  const driver = new CdpDriver();
  try {
    fake.status = 500;
    await assert.rejects(
      driver.connect({ transport: 'cdp', cdpPort: fake.port }),
      (error: any) => error.code === 'BROWSER_UNAVAILABLE' && /returned 500/.test(error.message),
    );
    fake.status = 200;
    await assert.rejects(
      driver.connect({ transport: 'cdp', cdpPort: fake.port, tabId: 'absent' }),
      (error: any) => /No debuggable page target/.test(error.message),
    );
    await assert.rejects(driver.connect({ transport: 'cdp', cdpPort: fake.port }), (error: any) =>
      /bare has no debugger websocket/.test(error.message),
    );
  } finally {
    await driver.disconnect();
    await fake.stop();
  }
});

test('tab open, focus and close issue the matching endpoint requests only when complete', async () => {
  await withCdp(
    [{ id: 'page-1' }, { id: 'page-2' }, { id: 'worker', type: 'service_worker' }],
    async (fake, driver) => {
      await driver.tabs({ action: 'open' });
      await driver.tabs({ action: 'focus' });
      await driver.tabs({ action: 'close' });
      assert.deepEqual(
        fake.requests.filter((line) => !line.endsWith('/json/list')),
        [],
      );

      await driver.tabs({ action: 'open', url: 'https://new.example/?q=1' });
      assert.ok(
        fake.requests.includes(`PUT /json/new?${encodeURIComponent('https://new.example/?q=1')}`),
      );

      const focused = await driver.tabs({ action: 'focus', tabId: 'page-2' });
      assert.ok(fake.requests.includes('GET /json/activate/page-2'));
      assert.deepEqual(
        focused.map((tab) => [tab.tabId, tab.active]),
        [
          ['page-1', false],
          ['page-2', true],
        ],
      );

      // Closing a background tab keeps the active one.
      const afterBackground = await driver.tabs({ action: 'close', tabId: 'page-1' });
      assert.deepEqual(
        afterBackground.map((tab) => [tab.tabId, tab.active]),
        [['page-2', true]],
      );
    },
  );
});

test('closing the active tab promotes the next page, and closing the last leaves none selected', async () => {
  await withCdp([{ id: 'page-1' }, { id: 'page-2' }], async (_fake, driver) => {
    const remaining = await driver.tabs({ action: 'close', tabId: 'page-1' });
    assert.deepEqual(
      remaining.map((tab) => [tab.tabId, tab.active]),
      [['page-2', true]],
    );
    assert.deepEqual(await driver.tabs({ action: 'close', tabId: 'page-2' }), []);
    await assert.rejects(
      driver.snapshot({ mode: 'a11y', maxNodes: 10 }),
      (error: any) => error.code === 'BROWSER_NOT_CONNECTED' && /No CDP target/.test(error.message),
    );
    await assert.rejects(
      driver.read({ tabId: 'ghost', format: 'text' }),
      (error: any) => error.code === 'NOT_FOUND',
    );
  });
});

test('a navigation error other than an abort is surfaced at once', async () => {
  await withCdp([{ id: 'page-1' }], async (fake, driver) => {
    fake.handlers['Page.navigate'] = () => ({
      frameId: 'f',
      errorText: 'net::ERR_NAME_NOT_RESOLVED',
    });
    await assert.rejects(
      driver.navigate({ url: 'https://nowhere.example/', waitUntil: 'load' }),
      (error: any) =>
        error.code === 'BROWSER_UNAVAILABLE' && /NAME_NOT_RESOLVED/.test(error.message),
    );
    assert.equal(fake.methods().filter((method) => method === 'Page.navigate').length, 1);
  });
});

test('an idle navigation with no history entry reports about:blank as a redirect', async () => {
  await withCdp([{ id: 'page-1' }], async (fake, driver) => {
    fake.handlers['Page.navigate'] = () => ({ frameId: 'f' });
    fake.handlers['Page.getNavigationHistory'] = () => ({ currentIndex: 3, entries: [] });
    const result = await driver.navigate({ url: 'https://idle.example/', waitUntil: 'idle' });
    assert.deepEqual(result, {
      tabId: 'page-1',
      url: 'about:blank',
      status: null,
      redirected: true,
    });
  });
});

test('a snapshot maps interesting AX nodes, marks credentials and truncates', async () => {
  await withCdp([{ id: 'page-1' }], async (_fake, driver) => {
    const snapshot: any = await driver.snapshot({ mode: 'a11y', maxNodes: 3 });
    assert.equal(snapshot.truncated, true);
    assert.deepEqual(snapshot.nodes, [
      { ref: 'ref_1_0', role: 'button', name: 'Save', disabled: true },
      { ref: 'ref_1_1', role: 'textbox', name: '', value: '42' },
      { ref: 'ref_1_2', role: 'textbox', name: 'Password', credentialField: true },
    ]);
    const full: any = await driver.snapshot({ mode: 'a11y', maxNodes: 10 });
    assert.equal(full.truncated, false);
    assert.equal(full.nodes.at(-1).name, 'More');
    assert.equal(full.nodes.at(-1).credentialField, undefined);
  });
});

test('an AX tree response without nodes is an empty snapshot', async () => {
  await withCdp([{ id: 'page-1' }], async (fake, driver) => {
    fake.handlers['Accessibility.getFullAXTree'] = () => ({});
    const snapshot: any = await driver.snapshot({ mode: 'a11y', maxNodes: 10 });
    assert.deepEqual(snapshot.nodes, []);
  });
});

test('each action kind reaches CDP, and failures are reported per action', async () => {
  await withCdp([{ id: 'page-1' }], async (fake, driver) => {
    await driver.snapshot({ mode: 'a11y', maxNodes: 10 });
    const results = await driver.act(
      [
        { op: 'click', selector: '#go' },
        { op: 'click', selector: '#ghost' },
        { op: 'type', text: 'no target' } as any,
        { op: 'type', ref: 'ref_1_1', text: 'hello', clear: true },
        { op: 'type', ref: 'ref_1_2', text: 'x' },
        { op: 'press_key', key: 'Enter' },
        { op: 'scroll', x: 5, y: 6, dx: 0, dy: 100 },
        { op: 'scroll', ref: 'ref_1_0', dy: 10 } as any,
        { op: 'select', ref: 'ref_1_1', value: 'B' },
        { op: 'wait_for', selector: '#go', timeoutMs: 1000 },
        { op: 'wait_for', ref: 'ref_1_0', text: 'Ready', timeoutMs: 1000 },
        { op: 'wait_for', timeoutMs: 1000 },
        { op: 'wait_for', selector: 'bad[', timeoutMs: 1000 },
        { op: 'wait_for', selector: '#never', timeoutMs: 100 },
      ] as any,
      { stopOnError: false },
    );
    assert.deepEqual(
      results.map((result) => (result.ok ? 'ok' : result.error!.code)),
      [
        'ok',
        'NOT_FOUND',
        'INVALID_REQUEST',
        'ok',
        'BROWSER_CREDENTIAL_FIELD_REFUSED',
        'ok',
        'ok',
        'ok',
        'ok',
        'ok',
        'ok',
        'ok',
        'INVALID_REQUEST',
        'BROWSER_TIMEOUT',
      ],
    );
    assert.deepEqual(mouse(fake)[0], {
      type: 'mousePressed',
      x: 20,
      y: 30,
      button: 'left',
      clickCount: 1,
    });
    const wheel = mouse(fake).filter((params) => params.type === 'mouseWheel');
    assert.deepEqual(
      wheel.map((params) => [params.x, params.y, params.deltaY]),
      [
        [5, 6, 100],
        [20, 30, 10],
      ],
    );
    const inserted = fake.calls.filter((call) => call.method === 'Input.insertText');
    assert.deepEqual(
      inserted.map((call) => call.params.text),
      ['hello', 'B'],
    );
    assert.ok(fake.calls.some((call) => call.params?.commands?.includes('SelectAll')));
  });
});

test('an uncoded CDP failure stops the batch as BROWSER_UNAVAILABLE', async () => {
  await withCdp([{ id: 'page-1' }], async (_fake, driver) => {
    const results = await driver.act(
      [
        { op: 'press_key', key: 'F13' },
        { op: 'press_key', key: 'Enter' },
      ],
      { stopOnError: true },
    );
    assert.equal(results.length, 1);
    assert.deepEqual(results[0]!.error, { code: 'BROWSER_UNAVAILABLE', message: 'Input failed' });
  });
});

test('reads scope to a ref as html, fail on an unmatched selector, and refuse stale refs', async () => {
  await withCdp([{ id: 'page-1' }], async (_fake, driver) => {
    await driver.snapshot({ mode: 'a11y', maxNodes: 10 });
    assert.equal((await driver.read({ ref: 'ref_1_0', format: 'html' })).content, '<b>Ready</b>');
    assert.equal((await driver.read({ format: 'text' })).content, 'Whole page');
    await assert.rejects(
      driver.read({ selector: '#none', format: 'text' }),
      (error: any) => error.code === 'NOT_FOUND' && /#none/.test(error.message),
    );
    await assert.rejects(
      driver.read({ ref: 'ref_0_0', format: 'text' }),
      (error: any) => error.code === 'BROWSER_REF_STALE',
    );
  });
});

test('logs drain the console and network events the page pushed', async () => {
  await withCdp([{ id: 'page-1' }], async (fake, driver) => {
    fake.push('page-1', {
      method: 'Log.entryAdded',
      params: { entry: { level: 'warning', text: 'careful' } },
    });
    fake.push('page-1', {
      method: 'Network.responseReceived',
      params: { response: { url: 'https://a.example/x', status: 204 } },
    });
    fake.handlers['Page.getNavigationHistory'] = () => ({
      currentIndex: 0,
      entries: [{ url: 'x' }],
    });
    // A request/response round trip orders the pushed events before the drain.
    await driver.read({ format: 'text' });
    const consoleLogs = await driver.logs({ logKind: 'console', limit: 10 });
    assert.deepEqual(
      consoleLogs.map((entry) => [entry.level, entry.text]),
      [['warning', 'careful']],
    );
    const network = await driver.logs({ logKind: 'network', limit: 10 });
    assert.deepEqual(
      network.map((entry) => [entry.url, entry.status]),
      [['https://a.example/x', 204]],
    );
  });
});
