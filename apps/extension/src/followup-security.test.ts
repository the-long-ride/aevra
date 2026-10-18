import { afterEach, expect, it, vi } from 'vitest';
import { clearConsoleLogs, createChromeBridge, recordConsoleLog } from './bridge';
import { installChrome } from './bridge-test-support';
import { dispatchNativeDrag } from './native-click';
afterEach(() => {
  clearConsoleLogs();
  delete (globalThis as any).chrome;
  vi.useRealTimers();
});

it('console logs are bound to the trusted top-frame tab and current document', async () => {
  installChrome([{ id: 1, active: true, url: 'https://safe.test' }]);
  let documentId = 'current';
  (globalThis as any).chrome.scripting.executeScript = async () => [{ documentId }];
  const record = recordConsoleLog as (...args: any[]) => void;
  record('safe', 'log', { tabId: 1, documentId: 'current' });
  record('other tab', 'log', { tabId: 2, documentId: 'current' });
  record('old document', 'log', { tabId: 1, documentId: 'old' });
  record('unattributed');
  expect((await createChromeBridge().logs('console', 50, '1')).map((entry) => entry.text)).toEqual([
    'safe',
  ]);
  documentId = 'replacement';
  expect(await createChromeBridge().logs('console', 50, '1')).toEqual([]);
});

it.each(['url', 'reload'])(
  'drag stops after %s navigation without releasing into replacement document',
  async (mode) => {
    vi.useFakeTimers();
    const tabs = [{ id: 1, active: true, url: 'https://safe.test' }];
    let onUpdated: ((id: number, info: chrome.tabs.TabChangeInfo) => void) | undefined;
    const fake = installChrome(tabs, {
      tabs: {
        onUpdated: {
          addListener: (fn: typeof onUpdated) => {
            onUpdated = fn;
          },
          removeListener: () => {
            onUpdated = undefined;
          },
        },
      },
      debugger: {
        sendCommand: async (_target: unknown, _method: string, params: any) => {
          if (params.type === 'mousePressed') {
            if (mode === 'url') tabs[0]!.url = 'https://blocked.test';
            else onUpdated?.(1, { status: 'loading' });
          }
        },
      },
    });
    const action = dispatchNativeDrag(
      1,
      { x: 1, y: 2 },
      { x: 5, y: 6 },
      undefined,
      'https://safe.test',
      'https://safe.test',
    );
    const result = action.then(
      () => null,
      (error) => error,
    );
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ code: 'BROWSER_INPUT_FAILED' });
    const events = fake.calls
      .debugger!.filter((row) => row[0] === 'send')
      .map((row) => row[3].type);
    expect(events).toEqual(['mousePressed']);
    expect(fake.calls.debugger!.at(-1)).toEqual(['detach', { tabId: 1 }]);
    expect(onUpdated).toBeUndefined();
  },
);
