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

function listenerDown() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Object.assign(new TypeError('Failed to fetch'), { cause: { code: 'ECONNREFUSED' } });
    }),
  );
}

describe('ExtensionRpc connection lifecycle', () => {
  it('reconnects after the socket closes', async () => {
    vi.useFakeTimers();
    try {
      await connectedRpc();
      const first = FakeSocket.last;
      first!.emit('close');
      await vi.advanceTimersByTimeAsync(3000);
      expect(FakeSocket.last).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays idle and opens no socket when enabled is false', async () => {
    installChrome({ ...paired, enabled: false });
    const { ExtensionRpc } = await import('./rpc');
    const rpc = new ExtensionRpc({} as never);
    await rpc.connect();
    expect(FakeSocket.last).toBeNull();
    expect(rpc.isConnected()).toBe(false);
  });

  it('resumes after an explicit enable following pause', async () => {
    const rpc = await connectedRpc();
    const previous = FakeSocket.last!;
    rpc.disconnect();
    await rpc.connect(true);
    expect(FakeSocket.last).not.toBe(previous);
    expect(rpc.status().state).toBe('connecting');
  });

  it('sends profileName in auth frame when configured', async () => {
    installChrome({ ...paired, profileName: 'Work Browser' });
    await connectedRpc();
    expect(FakeSocket.last!.sent[0]).toEqual({
      type: 'auth',
      token: 'issued-token',
      profileName: 'Work Browser',
    });
  });

  it('reports isConnected accurately and disconnect() stops connection and reconnects', async () => {
    vi.useFakeTimers();
    try {
      const rpc = await connectedRpc();
      expect(rpc.isConnected()).toBe(true);

      const socket = FakeSocket.last!;
      rpc.disconnect();
      expect(socket.closed).toBe(true);
      expect(rpc.isConnected()).toBe(false);

      // Advance timers to verify reconnect was not scheduled
      await vi.advanceTimersByTimeAsync(5000);
      expect(FakeSocket.last).toBe(socket);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears pending reconnect timer on disconnect()', async () => {
    vi.useFakeTimers();
    try {
      const rpc = await connectedRpc();
      const first = FakeSocket.last!;
      first.emit('close');
      // Reconnect is scheduled, now disconnect() should cancel the timer
      rpc.disconnect();
      await vi.advanceTimersByTimeAsync(5000);
      expect(FakeSocket.last).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries transient socket failures beyond three attempts while enabled', async () => {
    vi.useFakeTimers();
    try {
      const { ExtensionRpc } = await import('./rpc');
      const rpc = new ExtensionRpc({} as never);
      await rpc.connect();
      for (let i = 0; i < 5; i++) {
        const socket = FakeSocket.last!;
        socket.emit('close');
        await vi.advanceTimersByTimeAsync(35_000);
        expect(FakeSocket.last).not.toBe(socket);
        expect(rpc.status().state).toBe('connecting');
      }
      rpc.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires pairing again when the socket closes after auth but before auth_ok', async () => {
    vi.useFakeTimers();
    try {
      const { ExtensionRpc } = await import('./rpc');
      const rpc = new ExtensionRpc({} as never);
      await rpc.connect();
      const socket = FakeSocket.last!;
      socket.emit('open');
      socket.emit('close');
      expect(rpc.status().state).toBe('pair-again');
      expect(rpc.status().lastErrorCode).toBe('AUTH_UNACKNOWLEDGED');
      await vi.advanceTimersByTimeAsync(35_000);
      expect(FakeSocket.last).toBe(socket);
    } finally {
      vi.useRealTimers();
    }
  });

  // Chrome logs a refused WebSocket as an uncatchable extension error, so an
  // Aevra that is not running must never be dialled - only probed.
  it('opens no socket while Aevra is not running, and warns once rather than erroring', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      listenerDown();
      const { ExtensionRpc } = await import('./rpc');
      const rpc = new ExtensionRpc({} as never);
      await rpc.connect();
      expect(FakeSocket.last).toBeNull();
      expect(rpc.status()).toMatchObject({
        state: 'connecting',
        lastErrorCode: 'LISTENER_UNAVAILABLE',
      });
      await vi.advanceTimersByTimeAsync(35_000);
      expect(FakeSocket.last).toBeNull();
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('connects on the next retry once Aevra starts', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      listenerDown();
      const { ExtensionRpc } = await import('./rpc');
      const rpc = new ExtensionRpc({} as never);
      await rpc.connect();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 426 })),
      );
      await vi.advanceTimersByTimeAsync(35_000);
      expect(FakeSocket.last).not.toBeNull();
      FakeSocket.last!.emit('open');
      FakeSocket.last!.receive({ type: 'auth_ok' });
      expect(rpc.status().state).toBe('connected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('tries the WebSocket when the listener probe fails ambiguously', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { ExtensionRpc } = await import('./rpc');
    await new ExtensionRpc({} as never).connect();
    expect(FakeSocket.last).not.toBeNull();
  });

  it('does not probe or dial twice when connect is called during a probe', async () => {
    const { ExtensionRpc } = await import('./rpc');
    const rpc = new ExtensionRpc({} as never);
    await Promise.all([rpc.connect(), rpc.connect()]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('waits for auth_ok and offers pair again on an explicit credential rejection', async () => {
    const { ExtensionRpc } = await import('./rpc');
    const rpc = new ExtensionRpc({} as never);
    await rpc.connect();
    const socket = FakeSocket.last!;
    socket.emit('open');
    expect(rpc.isConnected()).toBe(false);
    expect(rpc.status().state).toBe('connecting');
    socket.receive({ type: 'auth_error', code: 'AUTH_REJECTED' });
    expect(rpc.status().state).toBe('pair-again');
    expect(rpc.status().lastErrorCode).toBe('AUTH_REJECTED');
    socket.emit('close');
    expect(rpc.status().state).toBe('pair-again');
    expect(rpc.status().lastErrorCode).toBe('AUTH_REJECTED');
    await rpc.connect();
    expect(FakeSocket.last).toBe(socket);
  });

  it('keeps a standby socket without reconnecting and activates it when selected', async () => {
    vi.useFakeTimers();
    try {
      const { ExtensionRpc } = await import('./rpc');
      const rpc = new ExtensionRpc({} as never);
      await rpc.connect();
      const socket = FakeSocket.last!;
      socket.emit('open');
      socket.receive({ type: 'auth_standby' });
      expect(rpc.status().state).toBe('standby');
      expect(rpc.isConnected()).toBe(false);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(FakeSocket.last).toBe(socket);
      socket.receive({ type: 'auth_ok' });
      expect(rpc.status().state).toBe('connected');
      expect(rpc.isConnected()).toBe(true);
      rpc.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pausing while a reconnect timer is pending prevents a later socket', async () => {
    vi.useFakeTimers();
    try {
      const rpc = await connectedRpc();
      const socket = FakeSocket.last!;
      socket.emit('close');
      rpc.disconnect();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(FakeSocket.last).toBe(socket);
      expect(rpc.status().state).toBe('paused');
    } finally {
      vi.useRealTimers();
    }
  });
});
