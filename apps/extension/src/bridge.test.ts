import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearConsoleLogs, createChromeBridge, recordConsoleLog } from './bridge';

interface FakeTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
}

function installChrome(tabs: FakeTab[], overrides: Record<string, any> = {}) {
  const listeners: Array<(id: number, info: { status?: string }) => void> = [];
  const calls: Record<string, any[]> = { executeScript: [], update: [], capture: [] };
  const chrome = {
    tabs: {
      async query(filter: { active?: boolean }) {
        return filter?.active ? tabs.filter((tab) => tab.active) : tabs;
      },
      async get(id: number) {
        return tabs.find((tab) => tab.id === id) ?? {};
      },
      async update(id: number, props: Record<string, unknown>) {
        calls.update!.push([id, props]);
        const tab = tabs.find((entry) => entry.id === id);
        if (tab && typeof props.url === 'string') tab.url = props.url;
        if (tab && props.active === true) tab.active = true;
      },
      async captureVisibleTab(_window: unknown, options: unknown) {
        calls.capture!.push(options);
        return 'data:image/png;base64,AAAA';
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

describe('tab targeting', () => {
  it('uses the active tab when none is named', async () => {
    const fake = installChrome([{ id: 7, active: true }]);
    await createChromeBridge().serialize();
    expect(fake.calls.executeScript![0].target).toEqual({ tabId: 7 });
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
  it('passes the ref index page-side, never an element reference', async () => {
    const fake = installChrome([{ id: 1, active: true }]);
    await createChromeBridge().apply({ op: 'click', ref: 'ref_3_5' } as never, 'ref_3_5');
    expect(fake.calls.executeScript![0].args[1]).toBe(5);
  });

  it('passes a null index when the action carries no ref', async () => {
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
  it('captures as png', async () => {
    const fake = installChrome([{ id: 1, active: true }]);
    expect(await createChromeBridge().captureVisible()).toMatch(/^data:image\/png;base64,/);
    expect(fake.calls.capture![0]).toEqual({ format: 'png' });
  });

  it('focuses a named tab first, since capture works on a window', async () => {
    const fake = installChrome([{ id: 1, active: true }, { id: 2 }]);
    await createChromeBridge().captureVisible('2');
    expect(fake.calls.update![0]).toEqual([2, { active: true }]);
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
