import { afterEach, expect, it, vi } from 'vitest';
import { FakeSocket, installChrome } from './rpc-test-support';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('refuses a pairing response outside loopback without replacing the saved server', async () => {
  const set = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', sendMessage: vi.fn() },
    storage: {
      local: { get: async () => ({ profileId: '12345678-1234-4123-8123-123456789abc' }), set },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: 'new-token',
            wsUrl: 'ws://evil.example:47843',
          }),
        ),
    ),
  );
  const { executePairing } = await import('./popup');
  const result = await executePairing('ABCDEFGH', 47841);
  expect(result.ok).toBe(false);
  expect(set).not.toHaveBeenCalled();
});

it('records the selected pairing origin separately from the WebSocket port', async () => {
  const set = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', sendMessage: vi.fn() },
    storage: {
      local: { get: async () => ({ profileId: '12345678-1234-4123-8123-123456789abc' }), set },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: 'new-token',
            wsUrl: 'ws://127.0.0.1:47843',
          }),
        ),
    ),
  );
  const { executePairing } = await import('./popup');
  expect((await executePairing('ABCDEFGH', 47841)).ok).toBe(true);
  expect(set).toHaveBeenCalledWith(
    expect.objectContaining({
      pairingOrigin: 'https://127.0.0.1:47841',
      pairingPort: 47841,
    }),
  );
});

it('a late old-server probe cannot dial after a successful switch', async () => {
  let stored = { token: 'root-token', wsUrl: 'ws://127.0.0.1:47833' };
  installChrome(stored);
  (globalThis as any).chrome.storage.local.get = async () => stored;
  vi.stubGlobal('WebSocket', FakeSocket);
  FakeSocket.last = null;
  let release!: (response: Response) => void;
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      ++calls === 1
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(new Response(null, { status: 426 })),
    ),
  );
  const { ExtensionRpc } = await import('./rpc');
  const rpc = new ExtensionRpc({} as never);
  const old = rpc.connect();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  stored = { token: 'browser-token', wsUrl: 'ws://127.0.0.1:47843' };
  rpc.newPairing();
  release(new Response(null, { status: 426 }));
  await old;
  await vi.waitFor(() => expect(FakeSocket.last?.url).toBe(stored.wsUrl));
  rpc.disconnect();
});
