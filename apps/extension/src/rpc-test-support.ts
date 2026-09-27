interface Frame {
  [key: string]: unknown;
}

/** Records what the extension sent and lets a test push frames back at it. */
export class FakeSocket {
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

export function installChrome(stored: Record<string, unknown>) {
  (globalThis as any).chrome = {
    storage: { local: { get: async () => stored, set: async () => undefined } },
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', onStartup: { addListener() {} } },
  };
}

export const paired = {
  token: 'issued-token',
  wsUrl: 'ws://127.0.0.1:47833',
};

export async function connectedRpc(bridge: Record<string, unknown> = {}) {
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
      return { imageDataUri: 'data:image/jpeg;base64,AAAA', devicePixelRatio: 1 };
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
  FakeSocket.last!.receive({ type: 'auth_ok' });
  return rpc;
}
