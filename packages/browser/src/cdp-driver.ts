import type {
  BrowserActionInput,
  BrowserActionResult,
  BrowserBox,
  BrowserLogEntry,
  BrowserSessionInfo,
  BrowserSnapshotResult,
  BrowserTabInfo,
  BrowserTransport,
} from '../../protocol/src/browser.js';
import { axTreeToNodes, markCredentialFields, type AxNode } from './cdp-ax.js';
import { CdpClient } from './cdp-client.js';
import { readDocument } from './cdp-read.js';
import { captureViewport } from './cdp-vision.js';
import { parseRef } from './dom-snapshot.js';
import { classifyOrigin } from './origin-policy.js';
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
} from './driver.js';

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

/**
 * Drives a browser over the Chrome DevTools Protocol. Refs come from the
 * accessibility tree, clicks from box models plus synthetic input events, and
 * text from serialized HTML — never from `Runtime.evaluate`, so neither the
 * page nor the model can get script executed through this driver.
 */
export class CdpDriver implements BrowserDriver {
  readonly transport: BrowserTransport = 'cdp';
  private client: CdpClient | null = null;
  private port = 9222;
  private targetId = '';
  private version = 0;
  private backendIds: number[] = [];
  private credentialRefs = new Set<string>();

  private require(): CdpClient {
    if (!this.client) {
      throw new BrowserDriverError('BROWSER_NOT_CONNECTED', 'No CDP session is connected');
    }
    return this.client;
  }

  private async targets(): Promise<CdpTarget[]> {
    const response = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    if (!response.ok) {
      throw new BrowserDriverError(
        'BROWSER_UNAVAILABLE',
        `CDP endpoint returned ${response.status}`,
      );
    }
    return (await response.json()) as CdpTarget[];
  }

  async connect(options: ConnectOptions): Promise<BrowserSessionInfo> {
    this.port = options.cdpPort ?? 9222;
    const pages = (await this.targets()).filter((target) => target.type === 'page');
    const page = options.tabId ? pages.find((target) => target.id === options.tabId) : pages[0];
    if (!page?.webSocketDebuggerUrl) {
      throw new BrowserDriverError('BROWSER_UNAVAILABLE', 'No debuggable page target was found');
    }
    this.targetId = page.id;
    this.client = await CdpClient.connect(page.webSocketDebuggerUrl);
    await this.client.send('Page.enable');
    await this.client.send('DOM.enable');
    await this.client.send('Accessibility.enable');
    await this.client.send('Log.enable');
    await this.client.send('Network.enable');
    return {
      sessionId: this.targetId,
      transport: 'cdp',
      connected: true,
      tabs: await this.tabs({ action: 'list' }),
    };
  }

  async tabs(request: TabRequest): Promise<BrowserTabInfo[]> {
    this.require();
    if (request.action === 'open' && request.url) {
      await fetch(`http://127.0.0.1:${this.port}/json/new?${encodeURIComponent(request.url)}`, {
        method: 'PUT',
      });
    }
    if (request.action === 'close' && request.tabId) {
      await fetch(`http://127.0.0.1:${this.port}/json/close/${request.tabId}`);
    }
    if (request.action === 'focus' && request.tabId) {
      await fetch(`http://127.0.0.1:${this.port}/json/activate/${request.tabId}`);
    }
    return (await this.targets())
      .filter((target) => target.type === 'page')
      .map((target) => ({
        tabId: target.id,
        url: target.url,
        title: target.title,
        active: target.id === this.targetId,
        originClass: classifyOrigin(target.url),
      }));
  }

  async navigate(request: NavigateRequest): Promise<NavigateResult> {
    const client = this.require();
    let result: { frameId: string; errorText?: string } = { frameId: '' };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await client.send<{ frameId: string; errorText?: string }>('Page.navigate', {
        url: request.url,
      });
      if (!result.errorText?.includes('ERR_ABORTED') || attempt === 2) break;
      // Chromium can report a provisional navigation as aborted while the
      // target is still settling after a newly opened page becomes usable.
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
    if (result.errorText) {
      throw new BrowserDriverError('BROWSER_UNAVAILABLE', result.errorText);
    }
    await new Promise((resolve) => setTimeout(resolve, request.waitUntil === 'idle' ? 750 : 250));
    const current = await this.currentUrl();
    return {
      tabId: this.targetId,
      url: current,
      status: null,
      redirected: current !== request.url,
    };
  }

  private async currentUrl(): Promise<string> {
    const client = this.require();
    const history = await client.send<{ entries: Array<{ url: string }>; currentIndex: number }>(
      'Page.getNavigationHistory',
    );
    return history.entries[history.currentIndex]?.url ?? 'about:blank';
  }

  async snapshot(request: SnapshotRequest): Promise<BrowserSnapshotResult> {
    const client = this.require();
    this.version += 1;
    const url = await this.currentUrl();
    const tree = await client.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
    const mapping = axTreeToNodes(tree.nodes ?? [], this.version, request.maxNodes);
    this.backendIds = mapping.backendIds;

    const attributesByIndex = new Map<number, string[]>();
    for (let index = 0; index < mapping.backendIds.length; index += 1) {
      try {
        // `DOM.describeNode` already carries the flat attribute list. Going via
        // `DOM.getAttributes` instead needs a frontend nodeId, which the DOM agent
        // only populates once the document has been pushed — it comes back 0 here,
        // and the credential guard then silently sees no attributes at all.
        const described = await client.send<{ node: { attributes?: string[] } }>(
          'DOM.describeNode',
          { backendNodeId: mapping.backendIds[index] },
        );
        attributesByIndex.set(index, described.node.attributes ?? []);
      } catch {
        attributesByIndex.set(index, []);
      }
    }
    markCredentialFields(mapping.nodes, attributesByIndex);
    this.credentialRefs = new Set(
      mapping.nodes.filter((node) => node.credentialField).map((node) => node.ref),
    );

    const base = {
      tabId: this.targetId,
      url,
      originClass: classifyOrigin(url),
      snapshotVersion: this.version,
      mode: request.mode,
      nodes: mapping.nodes,
      truncated: mapping.truncated,
    };
    if (request.mode === 'a11y') return base;
    const capture = await captureViewport(client);
    const boxes: Array<{ ref: string; label: string; box: BrowserBox }> = [];
    for (let index = 0; index < mapping.nodes.length; index += 1) {
      const box = await this.boxFor(index).catch(() => null);
      if (box) {
        boxes.push({ ref: mapping.nodes[index]!.ref, label: mapping.nodes[index]!.name, box });
      }
    }
    return { ...base, ...capture, boxes };
  }

  private async boxFor(index: number): Promise<BrowserBox> {
    const client = this.require();
    const model = await client.send<{
      model: { content: number[]; width: number; height: number };
    }>('DOM.getBoxModel', { backendNodeId: this.backendIds[index] });
    const [x1, y1, , , x3, y3] = model.model.content;
    return {
      x: Number(x1),
      y: Number(y1),
      width: Number(x3) - Number(x1),
      height: Number(y3) - Number(y1),
    };
  }

  private resolveIndex(ref: string): number {
    const parsed = parseRef(ref);
    if (parsed.version !== this.version || this.backendIds[parsed.index] === undefined) {
      throw new BrowserDriverError('BROWSER_REF_STALE', `${ref} is not from the current snapshot`);
    }
    return parsed.index;
  }

  async read(request: ReadRequest): Promise<ReadResult> {
    const client = this.require();
    const url = await this.currentUrl();
    const content = await readDocument(client, request, (ref) =>
      Number(this.backendIds[this.resolveIndex(ref)]),
    );
    return { tabId: this.targetId, url, content };
  }

  async act(actions: BrowserActionInput[], options: ActOptions): Promise<BrowserActionResult[]> {
    const results: BrowserActionResult[] = [];
    for (const action of actions) {
      const result = await this.perform(action);
      results.push(result);
      if (options.stopOnError && !result.ok) break;
    }
    return results;
  }

  private async perform(action: BrowserActionInput): Promise<BrowserActionResult> {
    const client = this.require();
    try {
      // Checked before any input is dispatched: approval cannot override it.
      if (action.op === 'type' && this.credentialRefs.has(action.ref)) {
        return {
          op: 'type',
          ok: false,
          error: {
            code: 'BROWSER_CREDENTIAL_FIELD_REFUSED',
            message: 'Refusing to type into a credential field',
          },
        };
      }
      if (action.op === 'click') {
        const point =
          action.x !== undefined && action.y !== undefined
            ? { x: action.x, y: action.y }
            : await this.centerOf(this.resolveIndex(String(action.ref)));
        for (const type of ['mousePressed', 'mouseReleased']) {
          await client.send('Input.dispatchMouseEvent', {
            type,
            x: point.x,
            y: point.y,
            button: 'left',
            clickCount: 1,
          });
        }
        return { op: 'click', ok: true };
      }
      if (action.op === 'type') {
        await client.send('DOM.focus', {
          backendNodeId: this.backendIds[this.resolveIndex(action.ref)],
        });
        await client.send('Input.insertText', { text: action.text });
        return { op: 'type', ok: true };
      }
      if (action.op === 'press_key') {
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: action.key });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: action.key });
        return { op: 'press_key', ok: true };
      }
      if (action.op === 'scroll') {
        const point =
          action.x !== undefined && action.y !== undefined
            ? { x: action.x, y: action.y }
            : await this.centerOf(this.resolveIndex(String(action.ref)));
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: point.x,
          y: point.y,
          deltaX: action.dx,
          deltaY: action.dy,
        });
        return { op: 'scroll', ok: true };
      }
      if (action.op === 'select') {
        await this.perform({ op: 'click', ref: action.ref });
        await client.send('Input.insertText', { text: action.value });
        return { op: 'select', ok: true };
      }
      const deadline = Date.now() + action.timeoutMs;
      while (Date.now() < deadline) {
        const read = await this.read({ format: 'text' });
        if (!action.text || read.content.includes(action.text)) return { op: 'wait_for', ok: true };
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return {
        op: 'wait_for',
        ok: false,
        error: { code: 'BROWSER_TIMEOUT', message: 'wait_for timed out' },
      };
    } catch (error) {
      const failure = error as BrowserDriverError;
      return {
        op: action.op,
        ok: false,
        error: { code: failure.code ?? 'BROWSER_UNAVAILABLE', message: failure.message },
      };
    }
  }

  private async centerOf(index: number): Promise<{ x: number; y: number }> {
    const box = await this.boxFor(index);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async logs(request: LogsRequest): Promise<BrowserLogEntry[]> {
    return this.require().drain(request.logKind, request.limit);
  }

  async disconnect(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.backendIds = [];
    this.credentialRefs.clear();
  }
}
