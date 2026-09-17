import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearConsoleLogs, createChromeBridge, recordConsoleLog } from './bridge';

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
        return { url: 'https://example.com/' };
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

describe('devicePixelRatio', () => {
  it('reads the ratio out of the page', async () => {
    installChrome({ readDevicePixelRatio: 2 });
    await expect(createChromeBridge().devicePixelRatio()).resolves.toBe(2);
  });

  it('falls back to 1 when the page cannot be reached', async () => {
    installChrome({ readDevicePixelRatio: new Error('no access') });
    await expect(createChromeBridge().devicePixelRatio()).resolves.toBe(1);
  });

  it('falls back to 1 when the page reports a nonsense ratio', async () => {
    installChrome({ readDevicePixelRatio: 0 });
    await expect(createChromeBridge().devicePixelRatio()).resolves.toBe(1);
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
