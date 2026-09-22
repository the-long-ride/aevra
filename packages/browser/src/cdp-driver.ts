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
import {
  cdpBoxForBackend,
  cdpCenterForBackend,
  clearFocusedCdpField,
  clickCdpPoint,
  resolveCdpSelector,
} from './cdp-selector.js';
import {
  CdpTargetSessionRegistry,
  type CdpTarget,
  type CdpTargetState,
} from './cdp-target-session.js';
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

/** Per-target CDP sessions; selecting a target does not activate it, and refs are target-safe. */
export class CdpDriver implements BrowserDriver {
  readonly transport: BrowserTransport = 'cdp';
  private port = 9222;
  private sessions: CdpTargetSessionRegistry | null = null;
  private snapshotSequence = 0;

  private registry(): CdpTargetSessionRegistry {
    if (!this.sessions) {
      throw new BrowserDriverError('BROWSER_NOT_CONNECTED', 'No CDP session is connected');
    }
    return this.sessions;
  }

  private async targets(): Promise<CdpTarget[]> {
    const response = await fetch('http://127.0.0.1:' + this.port + '/json/list');
    if (!response.ok) {
      throw new BrowserDriverError(
        'BROWSER_UNAVAILABLE',
        'CDP endpoint returned ' + response.status,
      );
    }
    return (await response.json()) as CdpTarget[];
  }

  async connect(options: ConnectOptions): Promise<BrowserSessionInfo> {
    await this.disconnect();
    this.port = options.cdpPort ?? 9222;
    this.snapshotSequence = 0;
    this.sessions = new CdpTargetSessionRegistry(() => this.targets());
    const initial = await this.sessions.connectInitial(options.tabId);
    return {
      sessionId: initial.id,
      transport: 'cdp',
      connected: true,
      tabs: await this.tabs({ action: 'list' }),
    };
  }

  async tabs(request: TabRequest): Promise<BrowserTabInfo[]> {
    const registry = this.registry();
    if (request.action === 'open' && request.url) {
      await fetch(
        'http://127.0.0.1:' + this.port + '/json/new?' + encodeURIComponent(request.url),
        { method: 'PUT' },
      );
    }
    if (request.action === 'close' && request.tabId) {
      await fetch('http://127.0.0.1:' + this.port + '/json/close/' + request.tabId);
      await registry.closeTarget(request.tabId);
      const remaining = (await this.targets()).find((target) => target.type === 'page');
      if (remaining && !registry.activeId()) registry.setActive(remaining.id);
    }
    if (request.action === 'focus' && request.tabId) {
      await fetch('http://127.0.0.1:' + this.port + '/json/activate/' + request.tabId);
      registry.setActive(request.tabId);
    }
    return (await this.targets())
      .filter((target) => target.type === 'page')
      .map((target) => ({
        tabId: target.id,
        url: target.url,
        title: target.title,
        active: target.id === registry.activeId(),
        originClass: classifyOrigin(target.url),
      }));
  }

  async navigate(request: NavigateRequest): Promise<NavigateResult> {
    const state = await this.registry().target(request.tabId);
    let result: { frameId: string; errorText?: string } = { frameId: '' };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await state.client.send<{ frameId: string; errorText?: string }>('Page.navigate', {
        url: request.url,
      });
      if (!result.errorText?.includes('ERR_ABORTED') || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
    if (result.errorText) {
      throw new BrowserDriverError('BROWSER_UNAVAILABLE', result.errorText);
    }
    await new Promise((resolve) => setTimeout(resolve, request.waitUntil === 'idle' ? 750 : 250));
    const current = await this.currentUrl(state);
    return {
      tabId: state.id,
      url: current,
      status: null,
      redirected: current !== request.url,
    };
  }

  private async currentUrl(state: CdpTargetState): Promise<string> {
    const history = await state.client.send<{
      entries: Array<{ url: string }>;
      currentIndex: number;
    }>('Page.getNavigationHistory');
    return history.entries[history.currentIndex]?.url ?? 'about:blank';
  }

  async snapshot(request: SnapshotRequest): Promise<BrowserSnapshotResult> {
    const state = await this.registry().target(request.tabId);
    state.version = ++this.snapshotSequence;
    const url = await this.currentUrl(state);
    const tree = await state.client.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
    const mapping = axTreeToNodes(tree.nodes ?? [], state.version, request.maxNodes);
    state.backendIds = mapping.backendIds;

    const attributesByIndex = new Map<number, string[]>();
    for (let index = 0; index < mapping.backendIds.length; index += 1) {
      try {
        const described = await state.client.send<{ node: { attributes?: string[] } }>(
          'DOM.describeNode',
          { backendNodeId: mapping.backendIds[index] },
        );
        attributesByIndex.set(index, described.node.attributes ?? []);
      } catch {
        attributesByIndex.set(index, []);
      }
    }
    markCredentialFields(mapping.nodes, attributesByIndex);
    state.credentialRefs = new Set(
      mapping.nodes.filter((node) => node.credentialField).map((node) => node.ref),
    );

    const base = {
      tabId: state.id,
      url,
      originClass: classifyOrigin(url),
      snapshotVersion: state.version,
      mode: request.mode,
      nodes: mapping.nodes,
      truncated: mapping.truncated,
    };
    if (request.mode === 'a11y') return base;
    const capture = await captureViewport(state.client);
    const boxes: Array<{ ref: string; label: string; box: BrowserBox }> = [];
    for (let index = 0; index < mapping.nodes.length; index += 1) {
      const box = await this.boxFor(state, index).catch(() => null);
      if (box) {
        boxes.push({ ref: mapping.nodes[index]!.ref, label: mapping.nodes[index]!.name, box });
      }
    }
    return { ...base, ...capture, boxes };
  }

  private async boxFor(state: CdpTargetState, index: number): Promise<BrowserBox> {
    return cdpBoxForBackend(state.client, Number(state.backendIds[index]));
  }

  private resolveIndex(state: CdpTargetState, ref: string): number {
    const parsed = parseRef(ref);
    if (parsed.version !== state.version || state.backendIds[parsed.index] === undefined) {
      throw new BrowserDriverError(
        'BROWSER_REF_STALE',
        ref + ' is not from the current target snapshot',
      );
    }
    return parsed.index;
  }

  async read(request: ReadRequest): Promise<ReadResult> {
    const state = await this.registry().target(request.tabId);
    return this.readState(state, request);
  }

  private async readState(state: CdpTargetState, request: Omit<ReadRequest, 'tabId'>) {
    const url = await this.currentUrl(state);
    const content = await readDocument(state.client, request, (ref) =>
      Number(state.backendIds[this.resolveIndex(state, ref)]),
    );
    return { tabId: state.id, url, content };
  }

  async act(actions: BrowserActionInput[], options: ActOptions): Promise<BrowserActionResult[]> {
    const state = await this.registry().target(options.tabId);
    const results: BrowserActionResult[] = [];
    for (const action of actions) {
      const result = await this.perform(state, action);
      results.push(result);
      if (options.stopOnError && !result.ok) break;
    }
    return results;
  }

  private async actionTarget(state: CdpTargetState, action: { ref?: string; selector?: string }) {
    if (action.selector) return resolveCdpSelector(state.client, action.selector);
    if (action.ref) {
      const index = this.resolveIndex(state, action.ref);
      return {
        backendNodeId: Number(state.backendIds[index]),
        credential: state.credentialRefs.has(action.ref),
      };
    }
    throw new BrowserDriverError('INVALID_REQUEST', 'Browser action requires a ref or selector');
  }

  private async perform(
    state: CdpTargetState,
    action: BrowserActionInput,
  ): Promise<BrowserActionResult> {
    const client = state.client;
    try {
      if (action.op === 'click') {
        const point =
          action.x !== undefined && action.y !== undefined
            ? { x: action.x, y: action.y }
            : await cdpCenterForBackend(
                client,
                (await this.actionTarget(state, action)).backendNodeId,
              );
        await clickCdpPoint(client, point);
        return { op: 'click', ok: true };
      }
      if (action.op === 'type') {
        const target = await this.actionTarget(state, action);
        if (target.credential) {
          return {
            op: 'type',
            ok: false,
            error: {
              code: 'BROWSER_CREDENTIAL_FIELD_REFUSED',
              message: 'Refusing to type into a credential field',
            },
          };
        }
        await client.send('DOM.focus', { backendNodeId: target.backendNodeId });
        if (action.clear) await clearFocusedCdpField(client);
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
            : await cdpCenterForBackend(
                client,
                (await this.actionTarget(state, action)).backendNodeId,
              );
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
        const target = await this.actionTarget(state, action);
        await clickCdpPoint(client, await cdpCenterForBackend(client, target.backendNodeId));
        await client.send('Input.insertText', { text: action.value });
        return { op: 'select', ok: true };
      }

      const deadline = Date.now() + action.timeoutMs;
      while (Date.now() < deadline) {
        if (action.selector) {
          try {
            await resolveCdpSelector(client, action.selector);
            return { op: 'wait_for', ok: true };
          } catch (error) {
            if ((error as BrowserDriverError).code === 'INVALID_REQUEST') throw error;
          }
        } else {
          const read = await this.readState(state, {
            ...(action.ref ? { ref: action.ref } : {}),
            format: 'text',
          });
          if (!action.text || read.content.includes(action.text)) {
            return { op: 'wait_for', ok: true };
          }
        }
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

  async logs(request: LogsRequest): Promise<BrowserLogEntry[]> {
    const state = await this.registry().target(request.tabId);
    return state.client.drain(request.logKind, request.limit);
  }

  async disconnect(): Promise<void> {
    const sessions = this.sessions;
    this.sessions = null;
    if (sessions) await sessions.closeAll();
  }
}
