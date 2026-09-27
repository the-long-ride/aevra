import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearConsoleLogs, createChromeBridge, recordConsoleLog } from './bridge';
import { installChrome } from './bridge-test-support';

beforeEach(() => clearConsoleLogs());
afterEach(() => {
  delete (globalThis as any).chrome;
});

describe('listTabs', () => {
  it('maps open tabs and skips ones with no id', async () => {
    installChrome([
      { id: 1, url: 'https://a.test/', title: 'A', active: true },
      { url: 'https://ghost.test/' },
    ]);
    const tabs = await createChromeBridge().listTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ tabId: '1', url: 'https://a.test/', active: true });
  });

  it('never classifies an origin - that is the worker’s job', async () => {
    installChrome([{ id: 1, url: 'https://mail.google.com/', title: 'Mail', active: true }]);
    const [tab] = await createChromeBridge().listTabs();
    expect(tab!.originClass).toBe('NORMAL');
  });

  it('tolerates a tab with no url or title', async () => {
    installChrome([{ id: 4 }]);
    const [tab] = await createChromeBridge().listTabs();
    expect(tab).toMatchObject({ tabId: '4', url: '', title: '', active: false });
  });
});

describe('focus', () => {
  it('does not acknowledge focus when Chrome leaves the target inactive', async () => {
    installChrome([{ id: 1, active: false, windowId: 1 }], {
      tabs: {
        async update() {
          return { id: 1, active: false, windowId: 1 };
        },
      },
    });
    await expect(createChromeBridge().focus('1')).rejects.toMatchObject({
      code: 'BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB',
    });
  });
});

describe('tab targeting', () => {
  it('focuses the target window and reports only its selected tab active', async () => {
    const fake = installChrome([
      { id: 1, windowId: 11, active: true },
      { id: 2, windowId: 22, active: true },
    ]);
    const bridge = createChromeBridge();
    expect((await bridge.listTabs()).filter((tab) => tab.active).map((tab) => tab.tabId)).toEqual([
      '1',
    ]);
    await bridge.focus('2');
    expect(fake.calls.update).toEqual([[2, { active: true }]]);
    expect(fake.calls.focusWindow).toEqual([[22, { focused: true }]]);
    expect((await bridge.listTabs()).filter((tab) => tab.active).map((tab) => tab.tabId)).toEqual([
      '2',
    ]);
  });

  it('uses the active tab when none is named', async () => {
    const fake = installChrome([{ id: 7, active: true }]);
    await createChromeBridge().serialize();
    const snapshotCall = fake.calls.executeScript!.at(-1);
    expect(snapshotCall.target).toEqual({ tabId: 7 });
    expect(snapshotCall.world).toBe('ISOLATED');
  });

  it('uses the named tab when one is given', async () => {
    const fake = installChrome([{ id: 7, active: true }, { id: 9 }]);
    await createChromeBridge().serialize('9');
    expect(fake.calls.executeScript![0].target).toEqual({ tabId: 9 });
  });

  it('reports NOT_FOUND when there is no active tab', async () => {
    installChrome([{ id: 3, active: false }]);
    await expect(createChromeBridge().serialize()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('apply', () => {
  it('sends a coordinate drag through native input instead of page script', async () => {
    const fake = installChrome([{ id: 9, active: true, url: 'https://example.test/' }]);
    const result = await createChromeBridge().apply(
      { op: 'drag', x: 10, y: 20, toX: 110, toY: 70 },
      null,
      '9',
    );
    expect(result).toEqual({ ok: true });
    expect(fake.calls.executeScript).toEqual([]);
    const sent = fake.calls.debugger.filter((call) => call[0] === 'send');
    expect(sent[0]?.[3]).toMatchObject({ type: 'mousePressed', x: 10, y: 20, button: 'left' });
    expect(sent.slice(1, -1).some((call) => call[3]?.type === 'mouseMoved')).toBe(true);
    expect(sent.at(-1)?.[3]).toMatchObject({ type: 'mouseReleased', x: 110, y: 70 });
    expect(fake.calls.debugger.at(-1)?.[0]).toBe('detach');
  });

  it('routes a coordinate-only click to native input on the named tab', async () => {
    const fake = installChrome([
      { id: 1, active: true, url: 'https://example.test/' },
      { id: 9, active: false, url: 'https://idngoalong.zing.vn/play-game-new' },
    ]);
    const result = await createChromeBridge().apply({ op: 'click', x: 555, y: 620 }, null, '9');
    expect(result).toEqual({ ok: true });
    expect(fake.calls.executeScript).toEqual([]);
    expect(fake.calls.debugger).toEqual([
      ['attach', { tabId: 9 }, '1.3'],
      [
        'send',
        { tabId: 9 },
        'Input.dispatchMouseEvent',
        {
          type: 'mousePressed',
          x: 555,
          y: 620,
          button: 'left',
          clickCount: 1,
        },
      ],
      [
        'send',
        { tabId: 9 },
        'Input.dispatchMouseEvent',
        {
          type: 'mouseReleased',
          x: 555,
          y: 620,
          button: 'left',
          clickCount: 1,
        },
      ],
      ['detach', { tabId: 9 }],
    ]);
  });

  it('keeps selector clicks in the isolated DOM path', async () => {
    const fake = installChrome([{ id: 1, active: true }]);
    expect(await createChromeBridge().apply({ op: 'click', selector: '#save' }, null, '1')).toEqual(
      { ok: true },
    );
    expect(fake.calls.executeScript).toHaveLength(1);
    expect(fake.calls.debugger).toEqual([]);
  });

  it('reports debugger attachment refusal without synthetic fallback', async () => {
    const fake = installChrome([{ id: 9, active: true, url: 'https://example.test/' }], {
      debugger: {
        async attach() {
          throw new Error('DevTools owns target');
        },
      },
    });
    expect(await createChromeBridge().apply({ op: 'click', x: 4, y: 5 }, null, '9')).toEqual({
      ok: false,
      code: 'BROWSER_NATIVE_INPUT_UNAVAILABLE',
    });
    expect(fake.calls.executeScript).toEqual([]);
  });

  it('passes request cancellation to native input before attachment', async () => {
    const fake = installChrome([{ id: 9, active: true, url: 'https://example.test/' }]);
    const outcome = await createChromeBridge().apply(
      { op: 'click', x: 4, y: 5 },
      null,
      '9',
      () => true,
    );
    expect(outcome).toEqual({ ok: false, code: 'BROWSER_INPUT_FAILED' });
    expect(fake.calls.debugger).toEqual([]);
    expect(fake.calls.executeScript).toEqual([]);
  });

  it('rejects malformed direct coordinate input before attaching', async () => {
    const fake = installChrome([{ id: 9, active: true, url: 'https://example.test/' }]);
    expect(await createChromeBridge().apply({ op: 'click', x: NaN, y: 5 }, null, '9')).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(fake.calls.debugger).toEqual([]);
    expect(fake.calls.executeScript).toEqual([]);
  });

  it('passes only the isolated-world opaque element id page-side', async () => {
    const fake = installChrome([{ id: 1, active: true }]);
    await createChromeBridge().apply({ op: 'click', ref: 'ref_3_5' } as never, 'element_42');
    expect(fake.calls.executeScript![0].args[1]).toBe('element_42');
    expect(fake.calls.executeScript![0].world).toBe('ISOLATED');
  });

  it('passes a null opaque id when the action carries no ref', async () => {
    const fake = installChrome([{ id: 1, active: true }]);
    await createChromeBridge().apply({ op: 'press_key', key: 'Enter' } as never, null);
    expect(fake.calls.executeScript![0].args[1]).toBeNull();
  });

  it('surfaces the page-side refusal code rather than a bare false', async () => {
    installChrome([{ id: 1, active: true }], {
      injected: { ok: false, code: 'BROWSER_CREDENTIAL_FIELD_REFUSED' },
    });
    const outcome = await createChromeBridge().apply({ op: 'type' } as never, 'ref_1_0');
    expect(outcome).toEqual({ ok: false, code: 'BROWSER_CREDENTIAL_FIELD_REFUSED' });
  });

  it('falls back to BROWSER_UNAVAILABLE when the page returns nothing', async () => {
    installChrome([{ id: 1, active: true }], { injected: undefined });
    const outcome = await createChromeBridge().apply({ op: 'click' } as never, null);
    expect(outcome).toEqual({ ok: false, code: 'BROWSER_UNAVAILABLE' });
  });
});

describe('navigate', () => {
  it('waits for the tab to report complete, then reports the final url', async () => {
    const fake = installChrome([{ id: 1, url: 'about:blank', active: true }]);
    const navigating = createChromeBridge().navigate('https://example.test/', 'load');
    await vi.waitFor(() => expect(fake.listenerCount()).toBeGreaterThan(0));
    fake.complete(1);
    const result = await navigating;
    expect(result).toMatchObject({ tabId: '1', url: 'https://example.test/', redirected: false });
  });

  it('reports a redirect when the tab settles somewhere else', async () => {
    const fake = installChrome([{ id: 1, url: 'about:blank', active: true }]);
    const navigating = createChromeBridge().navigate('https://example.test/', 'load');
    await vi.waitFor(() => expect(fake.listenerCount()).toBeGreaterThan(0));
    (globalThis as any).chrome.tabs.get = async () => ({ url: 'https://elsewhere.test/' });
    fake.complete(1);
    expect((await navigating).redirected).toBe(true);
  });

  it('removes its listener so repeated navigations do not accumulate them', async () => {
    const fake = installChrome([{ id: 1, active: true }]);
    const navigating = createChromeBridge().navigate('https://example.test/', 'load');
    await vi.waitFor(() => expect(fake.listenerCount()).toBe(1));
    fake.complete(1);
    await navigating;
    expect(fake.listenerCount()).toBe(0);
  });

  it('gives up rather than hanging when complete never arrives', async () => {
    vi.useFakeTimers();
    try {
      const fake = installChrome([{ id: 1, url: 'https://stuck.test/', active: true }]);
      const navigating = createChromeBridge().navigate('https://stuck.test/', 'load');
      await vi.advanceTimersByTimeAsync(31_000);
      await navigating;
      expect(fake.listenerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('logs', () => {
  it('returns console entries newest-last and honours the limit', async () => {
    installChrome([]);
    for (const text of ['one', 'two', 'three']) recordConsoleLog(text);
    const entries = await createChromeBridge().logs('console', 2);
    expect(entries.map((entry) => entry.text)).toEqual(['two', 'three']);
  });

  it('bounds the buffer instead of growing without limit', async () => {
    installChrome([]);
    for (let index = 0; index < 600; index += 1) recordConsoleLog(`line ${index}`);
    const entries = await createChromeBridge().logs('console', 1000);
    expect(entries).toHaveLength(500);
    expect(entries.at(-1)!.text).toBe('line 599');
  });

  it('returns nothing for network, which only the CDP transport supplies', async () => {
    installChrome([]);
    expect(await createChromeBridge().logs('network', 10)).toEqual([]);
  });
});
