import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket, paired } from './rpc-test-support';

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
  delete (globalThis as any).WebSocket;
  vi.unstubAllGlobals();
});

describe('service worker wiring', () => {
  it('connects a saved pairing as soon as the worker starts after reload', async () => {
    FakeSocket.last = null;
    (globalThis as any).chrome.storage.local.get = async () => paired;
    (globalThis as any).WebSocket = FakeSocket;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 426 })),
    );
    await import('./service-worker');
    await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
  });

  it('re-establishes the socket on startup signal', async () => {
    const { startServiceWorker } = await import('./service-worker');
    // Importing the module already starts one worker, as it does in Chrome.
    // Reset the registry so the assertions describe the instance held here.
    for (const key of Object.keys(registered)) delete registered[key];
    const rpc = startServiceWorker();
    const connect = vi.spyOn(rpc, 'connect').mockResolvedValue(undefined);

    expect(registered['startup'], 'startup has no listener').toHaveLength(1);
    registered['startup']![0]!();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('reconnects when the options page reports a successful pairing or popup sends connect', async () => {
    const { startServiceWorker } = await import('./service-worker');
    // Importing the module already starts one worker, as it does in Chrome.
    // Reset the registry so the assertions describe the instance held here.
    for (const key of Object.keys(registered)) delete registered[key];
    const rpc = startServiceWorker();
    const connect = vi.spyOn(rpc, 'connect').mockResolvedValue(undefined);
    registered.message![0]!({ type: 'aevra:paired' });
    expect(connect).toHaveBeenCalledTimes(1);
    registered.message![0]!({ type: 'aevra:connect' });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('disconnects when aevra:disconnect message arrives', async () => {
    const { startServiceWorker } = await import('./service-worker');
    for (const key of Object.keys(registered)) delete registered[key];
    const rpc = startServiceWorker();
    const disconnect = vi.spyOn(rpc, 'disconnect').mockImplementation(() => {});
    registered.message![0]!({ type: 'aevra:disconnect' });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('responds to aevra:getStatus with connection state', async () => {
    const { startServiceWorker } = await import('./service-worker');
    for (const key of Object.keys(registered)) delete registered[key];
    const rpc = startServiceWorker();
    vi.spyOn(rpc, 'isConnected').mockReturnValue(true);
    let reply: any;
    registered.message![0]!({ type: 'aevra:getStatus' }, {}, (response: any) => {
      reply = response;
    });
    expect(reply).toEqual(
      expect.objectContaining({ connected: true, state: 'unpaired', lastErrorCode: null }),
    );
  });

  it('attempts to connect when aevra:getStatus arrives and disconnected', async () => {
    const { startServiceWorker } = await import('./service-worker');
    for (const key of Object.keys(registered)) delete registered[key];
    const rpc = startServiceWorker();
    vi.spyOn(rpc, 'isConnected').mockReturnValue(false);
    const connect = vi.spyOn(rpc, 'connect').mockResolvedValue(undefined);
    let reply: any;
    registered.message![0]!({ type: 'aevra:getStatus' }, {}, (response: any) => {
      reply = response;
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(reply).toEqual(
      expect.objectContaining({ connected: false, state: 'unpaired', lastErrorCode: null }),
    );
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

  it('resets circuit breaker and connects with force when visiting Aevra Web UI', async () => {
    const { startServiceWorker } = await import('./service-worker');
    for (const key of Object.keys(registered)) delete registered[key];
    const rpc = startServiceWorker();
    const connect = vi.spyOn(rpc, 'connect').mockResolvedValue(undefined);

    registered.updated![0]!(1, { url: 'https://127.0.0.1:47831/#dashboard' }, {});
    expect(connect).toHaveBeenCalledWith(true);

    registered.updated![0]!(2, { url: 'https://google.com' }, {});
    // Non-Aevra pages should NOT trigger connection attempts
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
