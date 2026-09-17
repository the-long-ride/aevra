import type {
  BrowserActionInput,
  BrowserActionResult,
  BrowserLogEntry,
  BrowserSessionInfo,
  BrowserSnapshotResult,
  BrowserTabInfo,
  BrowserTransport,
} from '../../protocol/src/browser.js';
import {
  buildSnapshot,
  isCredentialField,
  RefRegistry,
  type SnapshotElementLike,
} from '../src/dom-snapshot.js';
import { classifyOrigin } from '../src/origin-policy.js';
import {
  BrowserDriverError,
  type ActOptions,
  type BrowserDriver,
  type ConnectOptions,
  type LogsRequest,
  type NavigateRequest,
  type NavigateResult,
  type ReadRequest,
  type ReadResult,
  type SnapshotRequest,
  type TabRequest,
} from '../src/driver.js';
import { FIXTURE_PAGE } from './fixtures.js';

export { FIXTURE_PAGE };

/**
 * Reference implementation of `BrowserDriver` over an in-memory page. It drives
 * the same `buildSnapshot` / `RefRegistry` / `isCredentialField` code the real
 * transports use, so the conformance suite has something to measure them
 * against and the tool layer can be tested without a browser.
 */
export class FakeDriver implements BrowserDriver {
  readonly transport: BrowserTransport;
  private connected = false;
  private version = 0;
  private url = 'about:blank';
  private readonly registry = new RefRegistry();
  readonly clicks: string[] = [];
  disconnected = false;
  failDisconnect = false;

  constructor(transport: BrowserTransport = 'extension') {
    this.transport = transport;
  }

  async connect(options: ConnectOptions): Promise<BrowserSessionInfo> {
    this.connected = true;
    return {
      sessionId: 'fake-session',
      transport: options.transport,
      connected: true,
      tabs: await this.tabs({ action: 'list' }),
    };
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new BrowserDriverError('BROWSER_NOT_CONNECTED', 'no browser session');
    }
  }

  async tabs(_request: TabRequest): Promise<BrowserTabInfo[]> {
    this.assertConnected();
    return [
      {
        tabId: 'tab-1',
        url: this.url,
        title: 'Invoices',
        active: true,
        originClass: classifyOrigin(this.url),
      },
    ];
  }

  async navigate(request: NavigateRequest): Promise<NavigateResult> {
    this.assertConnected();
    this.url = request.url;
    return { tabId: 'tab-1', url: this.url, status: 200, redirected: false };
  }

  async snapshot(request: SnapshotRequest): Promise<BrowserSnapshotResult> {
    this.assertConnected();
    this.version += 1;
    const snapshot = this.registry.record(
      buildSnapshot(FIXTURE_PAGE, { version: this.version, maxNodes: request.maxNodes }),
    );
    const base = {
      tabId: 'tab-1',
      url: this.url,
      originClass: classifyOrigin(this.url),
      snapshotVersion: this.version,
      mode: request.mode,
    };
    if (request.mode === 'a11y') {
      return { ...base, nodes: snapshot.nodes, truncated: snapshot.truncated };
    }
    return {
      ...base,
      nodes: snapshot.nodes,
      imageDataUri: 'data:image/png;base64,iVBORw0KGgo=',
      devicePixelRatio: 1,
      boxes: snapshot.nodes
        .filter((node) => node.box)
        .map((node) => ({ ref: node.ref, label: node.name, box: node.box! })),
    };
  }

  private textOf(node: SnapshotElementLike): string {
    const own = String(node.textContent ?? '').trim();
    return [own, ...(node.children ?? []).map((child) => this.textOf(child))]
      .filter(Boolean)
      .join('\n');
  }

  private find(node: SnapshotElementLike, tagName: string): SnapshotElementLike | null {
    if (node.tagName === tagName) return node;
    for (const child of node.children ?? []) {
      const found = this.find(child, tagName);
      if (found) return found;
    }
    return null;
  }

  async read(request: ReadRequest): Promise<ReadResult> {
    this.assertConnected();
    // Honours a selector the way the real drivers must: a scoped read returns
    // that element, not the whole document.
    const scoped = request.selector ? this.find(FIXTURE_PAGE, request.selector) : null;
    const content = scoped ? this.textOf(scoped) : this.textOf(FIXTURE_PAGE);
    return { tabId: 'tab-1', url: this.url, content };
  }

  async act(actions: BrowserActionInput[], options: ActOptions): Promise<BrowserActionResult[]> {
    this.assertConnected();
    const results: BrowserActionResult[] = [];
    for (const action of actions) {
      results.push(action.op === 'wait_for' ? await this.waitFor(action) : this.perform(action));
      if (options.stopOnError && !results[results.length - 1]!.ok) break;
    }
    return results;
  }

  private async waitFor(
    action: Extract<BrowserActionInput, { op: 'wait_for' }>,
  ): Promise<BrowserActionResult> {
    const deadline = Date.now() + action.timeoutMs;
    const page = this.textOf(FIXTURE_PAGE);
    while (Date.now() < deadline) {
      if (!action.text || page.includes(action.text)) return { op: 'wait_for', ok: true };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      op: 'wait_for',
      ok: false,
      error: { code: 'BROWSER_TIMEOUT', message: 'wait_for timed out' },
    };
  }

  private perform(action: BrowserActionInput): BrowserActionResult {
    if (action.op === 'click' && action.x !== undefined) {
      this.clicks.push(`${action.x},${action.y}`);
      return { op: 'click', ok: true, detail: 'coordinate click' };
    }
    const ref = 'ref' in action ? action.ref : undefined;
    if (!ref) return { op: action.op, ok: true };
    let element: SnapshotElementLike;
    try {
      element = this.registry.resolve(ref);
    } catch (error) {
      return {
        op: action.op,
        ok: false,
        error: { code: 'BROWSER_REF_STALE', message: String((error as Error).message) },
      };
    }
    if (action.op === 'type' && isCredentialField(element)) {
      return {
        op: 'type',
        ok: false,
        error: {
          code: 'BROWSER_CREDENTIAL_FIELD_REFUSED',
          message: 'Refusing to type into a credential field',
        },
      };
    }
    if (action.op === 'click') this.clicks.push(ref);
    return { op: action.op, ok: true };
  }

  async logs(_request: LogsRequest): Promise<BrowserLogEntry[]> {
    this.assertConnected();
    return [{ at: new Date().toISOString(), kind: 'console', level: 'log', text: 'ready' }];
  }

  async disconnect(): Promise<void> {
    if (this.failDisconnect) throw new Error('fake driver refused to disconnect');
    this.connected = false;
    this.disconnected = true;
  }
}
