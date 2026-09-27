import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectedRpc, FakeSocket, installChrome, paired } from './rpc-test-support';

beforeEach(() => {
  vi.resetModules();
  FakeSocket.last = null;
  (globalThis as any).WebSocket = FakeSocket;
  installChrome(paired);
  // The reachability probe answers "up" unless a test says the listener is down.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 426 })),
  );
});

afterEach(() => {
  delete (globalThis as any).chrome;
  delete (globalThis as any).WebSocket;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ExtensionRpc', () => {
  it('sends the token as the very first frame', async () => {
    await connectedRpc();
    expect(FakeSocket.last!.sent[0]).toEqual({ type: 'auth', token: 'issued-token' });
  });

  it('stays idle and opens no socket when nothing is paired', async () => {
    installChrome({});
    const { ExtensionRpc } = await import('./rpc');
    await new ExtensionRpc({} as never).connect();
    expect(FakeSocket.last).toBeNull();
  });

  it('does not open a second socket when connect is called again', async () => {
    const rpc = await connectedRpc();
    const first = FakeSocket.last;
    await rpc.connect();
    expect(FakeSocket.last).toBe(first);
  });

  it('keeps an authenticated WebSocket active before MV3 can suspend the worker', async () => {
    vi.useFakeTimers();
    try {
      const rpc = await connectedRpc();
      const socket = FakeSocket.last!;
      const sentBefore = socket.sent.length;

      await vi.advanceTimersByTimeAsync(20_000);
      expect(socket.sent.slice(sentBefore)).toContainEqual({ type: 'keepalive' });

      rpc.disconnect();
      const sentAfterDisconnect = socket.sent.length;
      await vi.advanceTimersByTimeAsync(40_000);
      expect(socket.sent.length).toBe(sentAfterDisconnect);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the socket when it reports an error', async () => {
    await connectedRpc();
    FakeSocket.last!.emit('error', {});
    expect(FakeSocket.last!.closed).toBe(true);
  });

  it('ignores a frame that is not a command', async () => {
    await connectedRpc();
    const before = FakeSocket.last!.sent.length;
    FakeSocket.last!.receive({ type: 'event', name: 'tab.updated' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(FakeSocket.last!.sent.length).toBe(before);
  });

  it('answers a command with a result frame carrying the same id', async () => {
    await connectedRpc();
    FakeSocket.last!.receive({ id: '7', type: 'cmd', op: 'tabs', params: {} });
    await vi.waitFor(() => expect(FakeSocket.last!.sent.length).toBeGreaterThan(1));
    const reply = FakeSocket.last!.sent.at(-1)!;
    expect(reply.id).toBe('7');
    expect(reply.type).toBe('result');
  });

  it('sends request-scoped capture stages before a vision result', async () => {
    await connectedRpc({
      async captureVisible(_tabId: string, onProgress?: (event: any) => void) {
        onProgress?.({ stage: 'capture_started', elapsedMs: 0 });
        onProgress?.({ stage: 'capture_api_done', elapsedMs: 4 });
        onProgress?.({ stage: 'encode_done', elapsedMs: 7, bytes: 32 });
        return { imageDataUri: 'data:image/jpeg;base64,AAAA', devicePixelRatio: 1 };
      },
    });
    const socket = FakeSocket.last!;
    socket.receive({ id: 'vision-1', type: 'cmd', op: 'snapshot', params: { mode: 'vision' } });
    await vi.waitFor(() =>
      expect(socket.sent.some((frame) => frame.id === 'vision-1' && frame.type === 'result')).toBe(
        true,
      ),
    );
    expect(
      socket.sent
        .filter((frame) => frame.id === 'vision-1')
        .map((frame) => frame.stage ?? frame.type),
    ).toEqual([
      'capture_started',
      'capture_api_done',
      'encode_done',
      'reply_send_attempt',
      'result',
    ]);
    expect(
      socket.sent.find((frame) => frame.id === 'vision-1' && frame.type === 'result')?.payload,
    ).toMatchObject({
      imageDataUri: 'data:image/jpeg;base64,AAAA',
      devicePixelRatio: 1,
    });
  });

  // The worker drops any frame over its cap without reading it, which used to
  // leave the caller waiting out the whole RPC budget for a reply that died.
  it('replaces a reply the worker would refuse with an error saying so', async () => {
    const { MAX_FRAME_BYTES } = await import('../../../packages/browser/src/frame-limits.js');
    await connectedRpc({
      async listTabs() {
        return [{ tabId: '1', url: 'x'.repeat(MAX_FRAME_BYTES), title: '', active: true }];
      },
    });
    FakeSocket.last!.receive({ id: '9', type: 'cmd', op: 'tabs', params: {} });
    await vi.waitFor(() => expect(FakeSocket.last!.sent.length).toBeGreaterThan(1));
    const reply = FakeSocket.last!.sent.at(-1)!;
    expect(reply).toMatchObject({
      id: '9',
      type: 'error',
      payload: { code: 'BROWSER_REPLY_TOO_LARGE' },
    });
  });

  it('reports a failing command as an error frame, not a dropped one', async () => {
    await connectedRpc({
      async listTabs() {
        throw Object.assign(new Error('tab enumeration failed'), { code: 'BROWSER_UNAVAILABLE' });
      },
    });
    FakeSocket.last!.receive({ id: '9', type: 'cmd', op: 'tabs', params: {} });
    await vi.waitFor(() => expect(FakeSocket.last!.sent.length).toBeGreaterThan(1));
    const reply = FakeSocket.last!.sent.at(-1)! as any;
    expect(reply.type).toBe('error');
    expect(reply.payload.code).toBe('BROWSER_UNAVAILABLE');
    expect(reply.payload.message).toContain('tab enumeration failed');
  });

  it('keeps the socket usable after a vision capture error', async () => {
    const rpc = await connectedRpc({
      async captureVisible() {
        throw Object.assign(new Error('canvas capture failed'), { code: 'BROWSER_CAPTURE_FAILED' });
      },
    });
    const socket = FakeSocket.last!;
    socket.receive({ id: 'vision', type: 'cmd', op: 'snapshot', params: { mode: 'vision' } });
    await vi.waitFor(() =>
      expect(socket.sent.some((frame) => frame.id === 'vision' && frame.type === 'error')).toBe(
        true,
      ),
    );
    expect(
      socket.sent.find((frame) => frame.id === 'vision' && frame.type === 'error'),
    ).toMatchObject({
      type: 'error',
      payload: { code: 'BROWSER_CAPTURE_FAILED' },
    });
    expect(
      socket.sent
        .filter((frame) => frame.id === 'vision')
        .map((frame) => frame.stage ?? frame.type),
    ).toEqual(['reply_send_attempt', 'error']);
    expect(rpc.isConnected()).toBe(true);

    socket.receive({ id: 'after', type: 'cmd', op: 'tabs', params: {} });
    await vi.waitFor(() => expect(socket.sent.some((frame) => frame.id === 'after')).toBe(true));
    expect(socket.sent.find((frame) => frame.id === 'after')?.type).toBe('result');
    expect(socket.closed).toBe(false);
    rpc.disconnect();
  });

  it('drops the reply to a cancelled command', async () => {
    await connectedRpc();
    FakeSocket.last!.receive({ type: 'cancel', id: '3' });
    FakeSocket.last!.receive({ id: '3', type: 'cmd', op: 'tabs', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(FakeSocket.last!.sent.filter((frame) => frame.id === '3')).toEqual([]);
  });

  it('stops a batch after cancellation while its first action is pending', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const actions: unknown[] = [];
    await connectedRpc({
      async apply(action: unknown) {
        actions.push(action);
        await gate;
        return { ok: true };
      },
    });
    const socket = FakeSocket.last!;
    socket.receive({
      id: 'batch',
      type: 'cmd',
      op: 'act',
      params: {
        actions: [
          { op: 'click', x: 4, y: 5 },
          { op: 'click', x: 8, y: 9 },
        ],
      },
    });
    await vi.waitFor(() => expect(actions).toHaveLength(1));
    socket.receive({ type: 'cancel', id: 'batch' });
    finish();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(actions).toHaveLength(1);
    expect(socket.sent.filter((frame) => frame.id === 'batch')).toEqual([]);
  });

  it('stops a batch when its socket closes while an action is pending', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const actions: unknown[] = [];
    await connectedRpc({
      async apply(action: unknown) {
        actions.push(action);
        await gate;
        return { ok: true };
      },
    });
    const socket = FakeSocket.last!;
    socket.receive({
      id: 'batch',
      type: 'cmd',
      op: 'act',
      params: {
        actions: [
          { op: 'click', x: 4, y: 5 },
          { op: 'click', x: 8, y: 9 },
        ],
      },
    });
    await vi.waitFor(() => expect(actions).toHaveLength(1));
    socket.close();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(actions).toHaveLength(1);
    expect(socket.sent.filter((frame) => frame.id === 'batch')).toEqual([]);
  });

  it('ignores a frame that is not JSON rather than dying', async () => {
    await connectedRpc();
    const socket = FakeSocket.last!;
    socket.emit('message', { data: 'not json' });
    socket.receive({ id: '1', type: 'cmd', op: 'tabs', params: {} });
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(1));
    expect(socket.sent.at(-1)!.type).toBe('result');
  });
});
