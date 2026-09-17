import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Frame {
  [key: string]: unknown;
}

/** Records what the extension sent and lets a test push frames back at it. */
class FakeSocket {
  static last: FakeSocket | null = null;
  static readonly OPEN = 1;
  readyState = 1;
  readonly sent: Frame[] = [];
  closed = false;
  private listeners = new Map<string, Array<(event: any) => void>>();

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  addEventListener(type: string, handler: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  emit(type: string, event: unknown = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }

  close() {
    this.closed = true;
    this.emit('close');
  }

  receive(payload: unknown) {
    this.emit('message', { data: JSON.stringify(payload) });
  }
}

function installChrome(stored: Record<string, unknown>) {
  (globalThis as any).chrome = {
    storage: { local: { get: async () => stored, set: async () => undefined } },
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', onStartup: { addListener() {} } },
  };
}

const paired = {
  token: 'issued-token',
  wsUrl: 'ws://127.0.0.1:47833',
};

async function connectedRpc(bridge: Record<string, unknown> = {}) {
  const { ExtensionRpc } = await import('./rpc');
  const rpc = new ExtensionRpc({
    async listTabs() {
      return [];
    },
    async serialize() {
      return { tagName: 'body', attributes: {}, children: [], textContent: 'Invoices' };
    },
    async apply() {
      return { ok: true };
    },
    async captureVisible() {
      return 'data:image/png;base64,AAAA';
    },
    async navigate(url: string) {
      return { tabId: '1', url, status: 200, redirected: false };
    },
    async logs() {
      return [];
    },
    ...bridge,
  } as never);
  await rpc.connect();
  FakeSocket.last!.emit('open');
  return rpc;
}

beforeEach(() => {
  vi.resetModules();
  FakeSocket.last = null;
  (globalThis as any).WebSocket = FakeSocket;
  installChrome(paired);
});

afterEach(() => {
  delete (globalThis as any).chrome;
  delete (globalThis as any).WebSocket;
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

  it('drops the reply to a cancelled command', async () => {
    await connectedRpc();
    FakeSocket.last!.receive({ type: 'cancel', id: '3' });
    FakeSocket.last!.receive({ id: '3', type: 'cmd', op: 'tabs', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(FakeSocket.last!.sent.filter((frame) => frame.id === '3')).toEqual([]);
  });

  it('ignores a frame that is not JSON rather than dying', async () => {
    await connectedRpc();
    FakeSocket.last!.emit('message', { data: 'not json' });
    FakeSocket.last!.receive({ id: '1', type: 'cmd', op: 'tabs', params: {} });
    await vi.waitFor(() => expect(FakeSocket.last!.sent.length).toBeGreaterThan(1));
    expect(FakeSocket.last!.sent.at(-1)!.type).toBe('result');
  });

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
});
