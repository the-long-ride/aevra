import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
// Each import registers a window listener; they are removed after every test
// so one test's script instance cannot answer another test's ping.
const added: Array<[string, EventListenerOrEventListenerObject]> = [];

function clearMarkers() {
  for (const name of [
    'data-aevra-extension-installed',
    'data-aevra-extension-version',
    'data-aevra-extension-id',
  ]) {
    document.documentElement.removeAttribute(name);
  }
}

beforeEach(() => {
  vi.resetModules();
  clearMarkers();
  const original = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: any) => {
    added.push([type, listener]);
    original(type, listener);
  }) as typeof window.addEventListener);
  (globalThis as any).chrome = {
    runtime: { id: EXTENSION_ID, getManifest: () => ({ version: '9.8.7' }) },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [type, listener] of added.splice(0)) window.removeEventListener(type, listener);
  delete (globalThis as any).chrome;
});

describe('content-detect presence signal', () => {
  it('marks the document and announces the extension as soon as it loads', async () => {
    const detected: unknown[] = [];
    const onDetected = (event: Event) => detected.push((event as CustomEvent).detail);
    window.addEventListener('aevra:extension-detected', onDetected);
    try {
      // @ts-expect-error content-detect is a classic content script (non-module) evaluated for side-effects
      await import('./content-detect');
    } finally {
      window.removeEventListener('aevra:extension-detected', onDetected);
    }

    const root = document.documentElement;
    expect(root.getAttribute('data-aevra-extension-installed')).toBe('true');
    expect(root.getAttribute('data-aevra-extension-version')).toBe('9.8.7');
    expect(root.getAttribute('data-aevra-extension-id')).toBe(EXTENSION_ID);
    expect(detected).toEqual([{ installed: true, version: '9.8.7', extensionId: EXTENSION_ID }]);
  });

  it('answers a page ping with a pong and re-advertises', async () => {
    const posted: unknown[] = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message);
    });
    // @ts-expect-error content-detect is a classic content script (non-module) evaluated for side-effects
    await import('./content-detect');
    clearMarkers();

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'aevra:ping-extension' } }));

    expect(posted).toEqual([
      {
        type: 'aevra:pong-extension',
        installed: true,
        version: '9.8.7',
        extensionId: EXTENSION_ID,
      },
    ]);
    expect(document.documentElement.getAttribute('data-aevra-extension-installed')).toBe('true');
  });

  it('ignores unrelated and data-less page messages', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    // @ts-expect-error content-detect is a classic content script (non-module) evaluated for side-effects
    await import('./content-detect');

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'something-else' } }));
    window.dispatchEvent(new MessageEvent('message', { data: null }));

    expect(post).not.toHaveBeenCalled();
  });

  it('stays silent when the extension runtime is unavailable', async () => {
    (globalThis as any).chrome = {
      runtime: {
        getManifest: () => {
          throw new Error('Extension context invalidated.');
        },
      },
    };
    // @ts-expect-error content-detect is a classic content script (non-module) evaluated for side-effects
    await expect(import('./content-detect')).resolves.toBeDefined();
    expect(document.documentElement.hasAttribute('data-aevra-extension-installed')).toBe(false);
  });
});
