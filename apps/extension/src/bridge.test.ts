import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearConsoleLogs, createChromeBridge, recordConsoleLog } from './bridge';
import { fitVisibleCapture } from './vision-capture';

// The re-encode needs OffscreenCanvas, which jsdom lacks; it has its own suite.
vi.mock('./vision-capture', () => ({
  fitVisibleCapture: vi.fn(async () => ({
    imageDataUri: 'data:image/jpeg;base64,/9j/',
    devicePixelRatio: 0.5,
  })),
}));

interface FakeTab {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
  active?: boolean;
  width?: number;
  height?: number;
}

function installChrome(tabs: FakeTab[], overrides: Record<string, any> = {}) {
  const listeners: Array<(id: number, info: { status?: string }) => void> = [];
  const calls: Record<string, any[]> = {
    executeScript: [],
    update: [],
    capture: [],
    focusWindow: [],
    debugger: [],
  };
  let focusedWindowId = tabs.find((tab) => tab.active)?.windowId;
  const chrome = {
    tabs: {
      async query(filter: { active?: boolean; lastFocusedWindow?: boolean }) {
        return tabs.filter(
          (tab) =>
            (!filter?.active || tab.active) &&
            (!filter?.lastFocusedWindow || tab.windowId === focusedWindowId),
        );
      },
      async get(id: number) {
        const tab = tabs.find((entry) => entry.id === id);
        return tab ? { ...tab, url: tab.url ?? 'https://example.test/' } : {};
      },
      async update(id: number, props: Record<string, unknown>) {
        calls.update!.push([id, props]);
        const tab = tabs.find((entry) => entry.id === id);
        if (tab && typeof props.url === 'string') tab.url = props.url;
        if (tab && props.active === true) {
          for (const entry of tabs) {
            if (entry.windowId === tab.windowId) entry.active = false;
          }
          tab.active = true;
        }
        return tab;
      },
      async captureVisibleTab(_window: unknown, options: unknown) {
        calls.capture!.push(options);
        return 'data:image/jpeg;base64,AAAA';
      },
      onUpdated: {
        addListener(fn: (id: number, info: { status?: string }) => void) {
          listeners.push(fn);
        },
        removeListener(fn: (id: number, info: { status?: string }) => void) {
          const at = listeners.indexOf(fn);
          if (at >= 0) listeners.splice(at, 1);
        },
      },
      ...overrides.tabs,
    },
    scripting: {
      async executeScript(input: Record<string, unknown>) {
        calls.executeScript!.push(input);
        return [{ result: 'injected' in overrides ? overrides.injected : { ok: true } }];
      },
    },
    windows: {
      async update(id: number, props: Record<string, unknown>) {
        calls.focusWindow!.push([id, props]);
        if (props.focused === true) focusedWindowId = id;
      },
    },
    debugger: {
      async attach(target: unknown, version: string) {
        calls.debugger!.push(['attach', target, version]);
        await overrides.debugger?.attach?.(target, version);
      },
      async sendCommand(target: unknown, method: string, params: unknown) {
        calls.debugger!.push(['send', target, method, params]);
        await overrides.debugger?.sendCommand?.(target, method, params);
      },
      async detach(target: unknown) {
        calls.debugger!.push(['detach', target]);
        await overrides.debugger?.detach?.(target);
      },
    },
  };
  (globalThis as any).chrome = chrome;
  return {
    calls,
    complete: (id: number) => listeners.forEach((fn) => fn(id, { status: 'complete' })),
    listenerCount: () => listeners.length,
  };
}

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

describe('captureVisible', () => {
  it('captures after the debugger banner changes the tab viewport', async () => {
    const tab = {
      id: 9,
      active: true,
      url: 'https://idngoalong.zing.vn/',
      windowId: 1,
      width: 1200,
      height: 600,
    };
    const fake = installChrome([tab], {
      debugger: {
        async attach() {
          tab.height = 540;
        },
      },
    });
    await createChromeBridge().captureVisible('9');
    expect(fake.calls.debugger[0]).toEqual(['attach', { tabId: 9 }, '1.3']);
    expect(vi.mocked(fitVisibleCapture)).toHaveBeenLastCalledWith('data:image/jpeg;base64,AAAA', {
      width: 1200,
      height: 540,
    });
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });

  it('measures vision annotations before the debugger viewport is restored', async () => {
    const tab = {
      id: 9,
      active: true,
      url: 'https://example.test/',
      windowId: 1,
      width: 800,
      height: 600,
    };
    const fake = installChrome([tab], {
      debugger: {
        async attach() {
          tab.height = 540;
        },
        async detach() {
          tab.height = 600;
        },
      },
    });
    const capture = await createChromeBridge().captureVisible('9', undefined, async () => ({
      tagName: 'button',
      attributes: {},
      textContent: 'Bottom button',
      box: { x: 10, y: tab.height - 40, width: 100, height: 30 },
      children: [],
    }));
    expect(capture.annotationRoot?.box?.y).toBe(500);
    expect(tab.height).toBe(600);
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });

  it('detaches a stalled vision capture at its deadline and allows a later capture', async () => {
    vi.useFakeTimers();
    try {
      let stall = true;
      const fake = installChrome(
        [{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }],
        {
          tabs: {
            async captureVisibleTab() {
              return stall ? new Promise<string>(() => {}) : 'data:image/jpeg;base64,AAAA';
            },
          },
        },
      );
      const first = createChromeBridge().captureVisible('1');
      const rejected = expect(first).rejects.toMatchObject({ code: 'BROWSER_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(26_000);
      await rejected;
      expect(fake.calls.debugger.filter((entry) => entry[0] === 'detach')).toHaveLength(1);
      stall = false;
      const second = createChromeBridge().captureVisible('1');
      await vi.advanceTimersByTimeAsync(200);
      await expect(second).resolves.toHaveProperty('imageDataUri');
      expect(fake.calls.debugger.filter((entry) => entry[0] === 'detach')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detaches a stalled capture promptly when its request is cancelled', async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const fake = installChrome(
        [{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }],
        {
          tabs: {
            async captureVisibleTab() {
              return new Promise<string>(() => {});
            },
          },
        },
      );
      const capture = createChromeBridge().captureVisible(
        '1',
        undefined,
        undefined,
        () => cancelled,
      );
      const rejected = expect(capture).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE' });
      await vi.advanceTimersByTimeAsync(150);
      cancelled = true;
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(fake.calls.debugger.filter((entry) => entry[0] === 'detach')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a cancelled vision request before attaching the debugger', async () => {
    const fake = installChrome([
      { id: 1, active: true, url: 'https://example.test/', windowId: 1 },
    ]);
    await expect(
      createChromeBridge().captureVisible('1', undefined, undefined, () => true),
    ).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE' });
    expect(fake.calls.debugger).toEqual([]);
  });

  it('detaches if the tab becomes inactive while the debugger viewport settles', async () => {
    const tab = { id: 1, active: true, url: 'https://example.test/', windowId: 1 };
    const fake = installChrome([tab], {
      debugger: {
        async attach() {
          tab.active = false;
        },
      },
    });
    await expect(createChromeBridge().captureVisible('1')).rejects.toMatchObject({
      code: 'BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB',
    });
    expect(fake.calls.capture).toEqual([]);
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 1 }]);
  });

  it('does not begin capture if cancelled while the debugger viewport settles', async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const fake = installChrome([
        { id: 1, active: true, url: 'https://example.test/', windowId: 1 },
      ]);
      const capture = createChromeBridge().captureVisible(
        '1',
        undefined,
        undefined,
        () => cancelled,
      );
      const rejected = expect(capture).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE' });
      await vi.advanceTimersByTimeAsync(50);
      cancelled = true;
      await vi.advanceTimersByTimeAsync(200);
      await rejected;
      expect(fake.calls.capture).toEqual([]);
      expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detaches when DOM annotation collection fails', async () => {
    const fake = installChrome([
      { id: 1, active: true, url: 'https://example.test/', windowId: 1 },
    ]);
    await expect(
      createChromeBridge().captureVisible('1', undefined, async () => {
        throw new Error('annotation failed');
      }),
    ).rejects.toThrow('annotation failed');
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 1 }]);
  });

  it('reports a failed debugger detach after capture', async () => {
    const fake = installChrome(
      [{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }],
      {
        debugger: {
          async detach() {
            throw new Error('detach failed');
          },
        },
      },
    );
    await expect(createChromeBridge().captureVisible('1')).rejects.toMatchObject({
      code: 'BROWSER_INPUT_FAILED',
    });
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 1 }]);
  });

  it('keeps a successful screenshot when a progress listener throws', async () => {
    installChrome([{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }]);
    await expect(
      createChromeBridge().captureVisible('1', () => {
        throw new Error('progress listener failed');
      }),
    ).resolves.toHaveProperty('imageDataUri');
  });

  it('ignores a capture result that arrives after the deadline', async () => {
    vi.useFakeTimers();
    try {
      let finishCapture!: (frame: string) => void;
      const pendingFrame = new Promise<string>((resolve) => (finishCapture = resolve));
      const fake = installChrome(
        [{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }],
        {
          tabs: { captureVisibleTab: () => pendingFrame },
        },
      );
      const progress: string[] = [];
      const capture = createChromeBridge().captureVisible('1', (event) =>
        progress.push(event.stage),
      );
      const rejected = expect(capture).rejects.toMatchObject({ code: 'BROWSER_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(26_000);
      await rejected;
      finishCapture('data:image/jpeg;base64,AAAA');
      await vi.advanceTimersByTimeAsync(0);
      expect(progress).toEqual(['capture_started']);
      expect(fake.calls.debugger.filter((entry) => entry[0] === 'detach')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a debugger conflict before returning coordinates that would not match input', async () => {
    const fake = installChrome(
      [{ id: 9, active: true, url: 'https://example.test/', windowId: 1 }],
      {
        debugger: {
          async attach() {
            throw new Error('DevTools owns target');
          },
        },
      },
    );
    await expect(createChromeBridge().captureVisible('9')).rejects.toMatchObject({
      code: 'BROWSER_NATIVE_INPUT_UNAVAILABLE',
    });
    expect(fake.calls.capture).toEqual([]);
  });

  it('reports the capture API and encoding stages without image content', async () => {
    installChrome([{ id: 1, active: true, width: 800, height: 500 }]);
    const progress: Array<{ stage: string; elapsedMs: number; bytes?: number }> = [];
    await (createChromeBridge().captureVisible as any)('1', (event: any) => progress.push(event));
    expect(progress.map((event) => event.stage)).toEqual([
      'capture_started',
      'capture_api_done',
      'encode_done',
    ]);
    expect(progress.every((event) => Number.isFinite(event.elapsedMs))).toBe(true);
    expect(progress.at(-1)?.bytes).toBeGreaterThan(0);
    expect(JSON.stringify(progress)).not.toContain('imageDataUri');
  });

  it('grabs one jpeg frame and returns it fitted to the transport budget', async () => {
    const fake = installChrome([{ id: 1, active: true }]);
    const shot = await createChromeBridge().captureVisible();
    expect(fake.calls.capture![0]).toEqual({ format: 'jpeg', quality: 90 });
    expect(fake.calls.executeScript).toHaveLength(0);
    expect(vi.mocked(fitVisibleCapture)).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA', null);
    expect(shot).toEqual({ imageDataUri: 'data:image/jpeg;base64,/9j/', devicePixelRatio: 0.5 });
  });

  it('uses tab viewport dimensions without asking the page for its pixel ratio', async () => {
    const fake = installChrome([{ id: 1, active: true, width: 800, height: 500 }]);
    await createChromeBridge().captureVisible('1');
    expect(fake.calls.executeScript).toHaveLength(0);
    expect(vi.mocked(fitVisibleCapture)).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA', {
      width: 800,
      height: 500,
    });
  });

  it('refuses vision capture for a named inactive tab instead of activating it', async () => {
    const fake = installChrome([
      { id: 1, active: true },
      { id: 2, active: false },
    ]);
    await expect(createChromeBridge().captureVisible('2')).rejects.toMatchObject({
      code: 'BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB',
    });
    expect(fake.calls.update).toHaveLength(0);
    expect(fake.calls.capture).toHaveLength(0);
  });

  it('captures a named tab when it is already active without changing selection', async () => {
    const fake = installChrome([{ id: 2, active: true }]);
    await createChromeBridge().captureVisible('2');
    expect(fake.calls.update).toHaveLength(0);
    expect(fake.calls.capture).toHaveLength(1);
  });

  it('rejects a screenshot if another tab becomes active during capture', async () => {
    const tabs = [
      { id: 1, active: true, windowId: 1 },
      { id: 2, active: false, windowId: 1 },
    ];
    installChrome(tabs, {
      tabs: {
        async captureVisibleTab() {
          tabs[0]!.active = false;
          tabs[1]!.active = true;
          return 'data:image/jpeg;base64,AAAA';
        },
      },
    });
    await expect(createChromeBridge().captureVisible('1')).rejects.toMatchObject({
      code: 'BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB',
    });
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
