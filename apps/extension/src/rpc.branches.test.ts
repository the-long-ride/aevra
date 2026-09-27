import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectedRpc, FakeSocket, installChrome, paired } from './rpc-test-support';

beforeEach(() => {
  vi.resetModules();
  FakeSocket.last = null;
  (globalThis as any).WebSocket = FakeSocket;
  installChrome(paired);
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
  vi.useRealTimers();
});

async function newRpc(bridge: Record<string, unknown> = {}) {
  const { ExtensionRpc } = await import('./rpc');
  return new ExtensionRpc(bridge as never);
}

describe('ExtensionRpc pairing identity', () => {
  it('sends a trimmed paired profile id and omits a blank one', async () => {
    installChrome({ ...paired, pairedProfileId: '  profile-a  ' });
    await connectedRpc();
    expect(FakeSocket.last!.sent[0]).toEqual({
      type: 'auth',
      token: 'issued-token',
      profileId: 'profile-a',
    });

    vi.resetModules();
    installChrome({ ...paired, pairedProfileId: '   ', profileName: '   ' });
    await connectedRpc();
    expect(FakeSocket.last!.sent[0]).toEqual({ type: 'auth', token: 'issued-token' });
  });
});

describe('ExtensionRpc lifecycle edges', () => {
  it('replaces the live socket on a new pairing without scheduling a reconnect', async () => {
    vi.useFakeTimers();
    const rpc = await connectedRpc();
    const previous = FakeSocket.last!;
    rpc.newPairing();
    await vi.advanceTimersByTimeAsync(0);
    expect(previous.closed).toBe(true);
    expect(FakeSocket.last).not.toBe(previous);
    expect(rpc.status().state).toBe('connecting');
    const replacement = FakeSocket.last;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.last).toBe(replacement);
  });

  it('pauses even when closing the socket throws', async () => {
    const rpc = await connectedRpc();
    FakeSocket.last!.close = () => {
      throw new Error('already closing');
    };
    expect(() => rpc.disconnect()).not.toThrow();
    expect(rpc.status().state).toBe('paused');
    expect(rpc.isConnected()).toBe(false);
  });

  it('a forced connect skips a pending backoff and dials at once', async () => {
    vi.useFakeTimers();
    const rpc = await connectedRpc();
    const first = FakeSocket.last!;
    first.emit('close');
    expect(FakeSocket.last).toBe(first);
    await rpc.connect(true);
    expect(FakeSocket.last).not.toBe(first);
    const second = FakeSocket.last;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.last).toBe(second);
  });

  it('opens nothing when paused while the pairing is still being read', async () => {
    const rpc = await newRpc();
    const pending = rpc.connect();
    rpc.disconnect();
    await pending;
    expect(FakeSocket.last).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(rpc.status().state).toBe('paused');
  });

  it('opens nothing when paused while the listener probe is in flight', async () => {
    let answer!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    const rpc = await newRpc();
    const pending = rpc.connect();
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    rpc.disconnect();
    answer(new Response(null, { status: 426 }));
    await pending;
    expect(FakeSocket.last).toBeNull();
  });

  it('sends no auth frame when the socket opens after a pause', async () => {
    const rpc = await newRpc();
    await rpc.connect();
    const socket = FakeSocket.last!;
    rpc.disconnect();
    socket.emit('open');
    expect(socket.sent).toEqual([]);
  });

  it('stops the keepalive and closes a socket whose send starts failing', async () => {
    vi.useFakeTimers();
    await connectedRpc();
    const socket = FakeSocket.last!;
    socket.send = () => {
      throw new Error('socket gone');
    };
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.closed).toBe(true);
  });

  it('stops the keepalive once the socket is no longer open', async () => {
    vi.useFakeTimers();
    await connectedRpc();
    const socket = FakeSocket.last!;
    const sent = socket.sent.length;
    socket.readyState = 3;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(socket.sent.length).toBe(sent);
  });
});

describe('ExtensionRpc command gating', () => {
  it('ignores commands before authentication and while on standby', async () => {
    const rpc = await newRpc({
      async listTabs() {
        return [];
      },
    });
    await rpc.connect();
    const socket = FakeSocket.last!;
    socket.emit('open');
    socket.receive({ id: 'early', type: 'cmd', op: 'tabs', params: {} });
    socket.receive({ type: 'auth_standby' });
    socket.receive({ id: 'standby', type: 'cmd', op: 'tabs', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(socket.sent.map((frame) => frame.type)).toEqual(['auth']);
  });

  it('ignores an auth_error that is not a credential rejection', async () => {
    const rpc = await newRpc();
    await rpc.connect();
    FakeSocket.last!.emit('open');
    FakeSocket.last!.receive({ type: 'auth_error', code: 'RATE_LIMITED' });
    expect(rpc.status().state).toBe('connecting');
  });

  it('runs a command that carries no params', async () => {
    const seen: unknown[] = [];
    await connectedRpc({
      async listTabs() {
        seen.push('listTabs');
        return [];
      },
    });
    FakeSocket.last!.receive({ id: 'np', type: 'cmd', op: 'tabs' });
    await vi.waitFor(() =>
      expect(FakeSocket.last!.sent.find((frame) => frame.id === 'np')?.type).toBe('result'),
    );
    expect(seen).toEqual(['listTabs']);
  });

  it('defaults the error code and stringifies a non-Error failure', async () => {
    await connectedRpc({
      async listTabs() {
        throw 'plain failure';
      },
    });
    FakeSocket.last!.receive({ id: 'e1', type: 'cmd', op: 'tabs', params: {} });
    await vi.waitFor(() =>
      expect(FakeSocket.last!.sent.some((frame) => frame.id === 'e1')).toBe(true),
    );
    expect(FakeSocket.last!.sent.find((frame) => frame.id === 'e1')).toEqual({
      id: 'e1',
      type: 'error',
      payload: { code: 'BROWSER_UNAVAILABLE', message: 'plain failure' },
    });
  });

  it('drops a reply whose socket stopped being open mid-command', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    let started = false;
    await connectedRpc({
      async listTabs() {
        started = true;
        await gate;
        return [];
      },
    });
    const socket = FakeSocket.last!;
    socket.receive({ id: 'late', type: 'cmd', op: 'tabs', params: {} });
    await vi.waitFor(() => expect(started).toBe(true));
    socket.readyState = 3;
    finish();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(socket.sent.filter((frame) => frame.id === 'late')).toEqual([]);
  });
});
