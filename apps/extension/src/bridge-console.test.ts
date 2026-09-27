import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearConsoleLogs, createChromeBridge, recordConsoleLog } from './bridge';
import { fitVisibleCapture } from './vision-capture';

vi.mock('./vision-capture', () => ({
  fitVisibleCapture: vi.fn(async () => ({
    imageDataUri: 'data:image/jpeg;base64,',
    devicePixelRatio: 1,
  })),
}));

interface Injection {
  funcName: string;
  world?: string;
  tabId: number;
}

/**
 * Fakes only chrome.*, so the bridge under test is the shipped one. Results are
 * chosen by which page function was injected, because that is exactly what the
 * bridge dispatches on.
 */
function installChrome(results: Record<string, unknown> = {}) {
  const injections: Injection[] = [];
  const loadListeners: Array<(id: number, info: { status?: string }) => void> = [];
  (globalThis as any).chrome = {
    tabs: {
      async query() {
        return [{ id: 7, url: 'https://example.com/', title: 'Example', active: true }];
      },
      async get() {
        return { id: 7, url: 'https://example.com/', active: true, windowId: 1 };
      },
      async captureVisibleTab() {
        return 'data:image/jpeg;base64,AAAA';
      },
      async update(id: number) {
        // Chrome reports the load asynchronously; without it the bridge would
        // sit on its navigate timeout.
        setTimeout(() => loadListeners.forEach((fn) => fn(id, { status: 'complete' })), 0);
      },
      onUpdated: {
        addListener(fn: (id: number, info: { status?: string }) => void) {
          loadListeners.push(fn);
        },
        removeListener(fn: (id: number, info: { status?: string }) => void) {
          const at = loadListeners.indexOf(fn);
          if (at >= 0) loadListeners.splice(at, 1);
        },
      },
    },
    scripting: {
      async executeScript(input: any) {
        const funcName = String(input.func?.name ?? '');
        injections.push({ funcName, world: input.world, tabId: input.target.tabId });
        if (funcName in results) {
          const value = results[funcName];
          if (value instanceof Error) throw value;
          return [{ result: value }];
        }
        return [{ result: { ok: true } }];
      },
    },
    debugger: {
      async attach() {},
      async detach() {},
    },
  };
  return injections;
}

beforeEach(() => clearConsoleLogs());
afterEach(() => {
  delete (globalThis as any).chrome;
});

describe('console capture injection', () => {
  it('installs the relay in the isolated world and the patch in the main world', async () => {
    const injections = installChrome();
    await createChromeBridge().serialize();

    const relay = injections.find((entry) => entry.funcName === 'installConsoleRelay');
    const capture = injections.find((entry) => entry.funcName === 'installConsoleCapture');
    expect(relay?.world).toBeUndefined();
    expect(capture?.world).toBe('MAIN');
    // Both must land before the page is serialized, or the snapshot's own load
    // would already have escaped capture.
    expect(injections.map((entry) => entry.funcName)).toEqual([
      'installConsoleRelay',
      'installConsoleCapture',
      'serializePage',
    ]);
  });

  it('re-establishes capture after a navigation replaces the page', async () => {
    const injections = installChrome();
    await createChromeBridge().navigate('https://example.com/next', 'load');
    expect(injections.filter((entry) => entry.funcName === 'installConsoleCapture')).toHaveLength(
      1,
    );
  });

  it('still serializes when a restricted page refuses the capture injection', async () => {
    installChrome({
      installConsoleRelay: new Error('cannot access this page'),
      serializePage: { tagName: 'body', attributes: {}, children: [], textContent: '' },
    });
    await expect(createChromeBridge().serialize()).resolves.toMatchObject({ tagName: 'body' });
  });

  it('targets the named tab rather than the active one', async () => {
    const injections = installChrome();
    await createChromeBridge().serialize('3');
    expect(injections.every((entry) => entry.tabId === 3)).toBe(true);
  });
});

describe('the viewport a capture is fitted with', () => {
  it('uses Chrome tab dimensions without injecting code into the page', async () => {
    const injections = installChrome();
    (globalThis as any).chrome.tabs.get = async () => ({
      id: 7,
      url: 'https://example.com/',
      active: true,
      windowId: 1,
      width: 800,
      height: 500,
    });
    vi.mocked(fitVisibleCapture).mockClear();
    await createChromeBridge().captureVisible();
    expect(injections).toHaveLength(0);
    expect(vi.mocked(fitVisibleCapture).mock.calls[0]![1]).toEqual({ width: 800, height: 500 });
  });

  it('lets the frame dimensions serve as a fallback when Chrome omits tab dimensions', async () => {
    const injections = installChrome();
    vi.mocked(fitVisibleCapture).mockClear();
    await createChromeBridge().captureVisible();
    expect(injections).toHaveLength(0);
    expect(vi.mocked(fitVisibleCapture).mock.calls[0]![1]).toBeNull();
  });
});

describe('recordConsoleLog', () => {
  it('keeps the level the page reported', async () => {
    installChrome();
    recordConsoleLog('something failed', 'error');
    const [entry] = await createChromeBridge().logs('console', 10);
    expect(entry).toMatchObject({ kind: 'console', level: 'error', text: 'something failed' });
  });

  it('defaults the level when none is given', async () => {
    installChrome();
    recordConsoleLog('plain line');
    const [entry] = await createChromeBridge().logs('console', 10);
    expect(entry!.level).toBe('log');
  });
});
