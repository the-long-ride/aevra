import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registered: Record<string, Array<(...args: any[]) => void>> = {};

function listener(name: string) {
  return {
    addListener(fn: (...args: any[]) => void) {
      registered[name] = [...(registered[name] ?? []), fn];
    },
    removeListener() {},
  };
}

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(registered)) delete registered[key];
  (globalThis as any).chrome = {
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      onStartup: listener('startup'),
      onInstalled: listener('installed'),
      onMessage: listener('message'),
    },
    tabs: {
      onUpdated: listener('updated'),
      async query() {
        return [];
      },
    },
    // Unpaired, so the worker wires itself up but opens no socket.
    storage: { local: { get: async () => ({}), set: async () => undefined } },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
});

describe('service worker wiring', () => {
  it('re-establishes the socket on every wake-up signal MV3 gives it', async () => {
    const { startServiceWorker } = await import('./service-worker');
    // Importing the module already starts one worker, as it does in Chrome.
    // Reset the registry so the assertions describe the instance held here.
    for (const key of Object.keys(registered)) delete registered[key];
    const rpc = startServiceWorker();
    const connect = vi.spyOn(rpc, 'connect').mockResolvedValue(undefined);

    for (const signal of ['startup', 'installed', 'updated']) {
      expect(registered[signal], `${signal} has no listener`).toHaveLength(1);
      registered[signal]![0]!();
    }
    // MV3 evicts an idle worker; each of these is a chance to reconnect.
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('reconnects when the options page reports a successful pairing', async () => {
    const { startServiceWorker } = await import('./service-worker');
    // Importing the module already starts one worker, as it does in Chrome.
    // Reset the registry so the assertions describe the instance held here.
    for (const key of Object.keys(registered)) delete registered[key];
    const rpc = startServiceWorker();
    const connect = vi.spyOn(rpc, 'connect').mockResolvedValue(undefined);
    registered.message![0]!({ type: 'aevra:paired' });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('records forwarded console text without reconnecting', async () => {
    const { startServiceWorker } = await import('./service-worker');
    const { createChromeBridge } = await import('./bridge');
    const rpc = startServiceWorker();
    const connect = vi.spyOn(rpc, 'connect').mockResolvedValue(undefined);

    registered.message![0]!({ type: 'aevra:console', text: 'page said something' });
    expect(connect).not.toHaveBeenCalled();
    const entries = await createChromeBridge().logs('console', 10);
    expect(entries.at(-1)!.text).toBe('page said something');
  });

  it('ignores an unrecognised runtime message', async () => {
    const { startServiceWorker } = await import('./service-worker');
    // Importing the module already starts one worker, as it does in Chrome.
    // Reset the registry so the assertions describe the instance held here.
    for (const key of Object.keys(registered)) delete registered[key];
    const rpc = startServiceWorker();
    const connect = vi.spyOn(rpc, 'connect').mockResolvedValue(undefined);
    registered.message![0]!({ type: 'something-else' });
    registered.message![0]!(undefined);
    expect(connect).not.toHaveBeenCalled();
  });
});
