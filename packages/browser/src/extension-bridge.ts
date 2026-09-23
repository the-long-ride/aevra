import type {
  BrowserActionInput,
  BrowserActionResult,
  BrowserBox,
  BrowserLogEntry,
  BrowserSnapshotResult,
  BrowserTabInfo,
} from '../../protocol/src/browser.js';
import type { NavigateResult } from './driver.js';
import { classifyOrigin } from './origin-policy.js';
import { buildSnapshot, RefRegistry, type SnapshotElementLike } from './dom-snapshot.js';

export interface ExtensionBridge {
  listTabs(): Promise<BrowserTabInfo[]>;
  serialize(tabId?: string): Promise<SnapshotElementLike>;
  devicePixelRatio(tabId?: string): Promise<number>;
  apply(
    action: BrowserActionInput,
    elementId: string | null,
    tabId?: string,
  ): Promise<{ ok: boolean; code?: string }>;
  captureVisible(tabId?: string): Promise<string>;
  navigate(url: string, waitUntil: 'load' | 'idle', tabId?: string): Promise<NavigateResult>;
  logs(kind: 'console' | 'network', limit: number, tabId?: string): Promise<BrowserLogEntry[]>;
}

export interface ExtensionCommand {
  op: 'tabs' | 'navigate' | 'snapshot' | 'read' | 'act' | 'logs';
  params: Record<string, any>;
}

function failure(op: BrowserActionInput['op'], code: string, message: string): BrowserActionResult {
  return { op, ok: false, error: { code, message } };
}

async function act(
  registry: RefRegistry,
  bridge: ExtensionBridge,
  params: Record<string, any>,
): Promise<BrowserActionResult[]> {
  const actions: BrowserActionInput[] = Array.isArray(params.actions) ? params.actions : [];
  const results: BrowserActionResult[] = [];
  for (const action of actions) {
    const ref = 'ref' in action && action.ref ? String(action.ref) : null;
    let elementId: string | null = null;
    if (ref) {
      if (!registry.has(ref)) {
        results.push(
          failure(action.op, 'BROWSER_REF_STALE', `${ref} is from an older page snapshot`),
        );
        if (params.stopOnError !== false) break;
        continue;
      }
      // Not policy-configurable and not overridable by approval: the user types
      // passwords, one-time codes, and card fields themselves.
      if (action.op === 'type' && registry.isCredential(ref)) {
        results.push(
          failure(
            action.op,
            'BROWSER_CREDENTIAL_FIELD_REFUSED',
            'Aevra will not type into a credential field',
          ),
        );
        if (params.stopOnError !== false) break;
        continue;
      }
      elementId = registry.resolve(ref).elementId ?? null;
      if (!elementId) {
        results.push(
          failure(action.op, 'BROWSER_REF_STALE', `${ref} has no isolated-world element identity`),
        );
        if (params.stopOnError !== false) break;
        continue;
      }
    }
    const outcome = await bridge.apply(action, elementId, params.tabId);
    // The page-side code reports *why* it refused - a credential field, a timed
    // out wait. Dropping the code here would surface every failure as a bare
    // false and leave the two transports disagreeing on error reporting.
    results.push(
      outcome.ok
        ? { op: action.op, ok: true }
        : failure(
            action.op,
            outcome.code ?? 'BROWSER_UNAVAILABLE',
            `${action.op} did not complete in the page`,
          ),
    );
    if (!outcome.ok && params.stopOnError !== false) break;
  }
  return results;
}

function scaleBox(box: BrowserBox, scale: number): BrowserBox {
  return {
    x: box.x * scale,
    y: box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

async function snapshot(
  registry: RefRegistry,
  bridge: ExtensionBridge,
  params: Record<string, any>,
): Promise<BrowserSnapshotResult> {
  const tabs = await bridge.listTabs();
  const tab = params.tabId
    ? tabs.find((entry) => entry.tabId === params.tabId)
    : tabs.find((entry) => entry.active);
  const root = await bridge.serialize(params.tabId);
  // Each snapshot takes the next version, which is what makes an older ref
  // stale rather than silently rebound to a different element.
  const built = registry.record(
    buildSnapshot(root, {
      version: registry.version() + 1,
      maxNodes: Number(params.maxNodes ?? 400),
    }),
  );
  const base = {
    tabId: tab?.tabId ?? '',
    url: tab?.url ?? '',
    // Fail closed: an unresolved tab has no url, and classifyOrigin('') is BLOCKED.
    originClass: tab?.originClass ?? classifyOrigin(tab?.url ?? ''),
    snapshotVersion: registry.version(),
  };
  if (params.mode === 'vision') {
    // The screenshot comes back in device pixels while every box is in CSS
    // pixels. Scaling the boxes into the image's own space is what lets a model
    // point at what it sees; the ratio travels with the result so the caller can
    // convert back.
    const devicePixelRatio = await bridge.devicePixelRatio(params.tabId);
    return {
      ...base,
      mode: 'vision',
      imageDataUri: await bridge.captureVisible(params.tabId),
      devicePixelRatio,
      boxes: built.nodes
        .filter((node) => node.box)
        .map((node) => ({
          ref: node.ref,
          label: node.name,
          box: scaleBox(node.box!, devicePixelRatio),
        })),
    };
  }
  return { ...base, mode: 'a11y', nodes: built.nodes, truncated: built.truncated };
}

/**
 * A deliberately small selector subset - tag, #id, .class - matched against the
 * serialized tree. It exists so a scoped read returns one element rather than
 * the whole document; anything richer belongs in the page, not here.
 */
function findBySelector(
  node: SnapshotElementLike,
  selector: string,
): SnapshotElementLike | null {
  const matches = (candidate: SnapshotElementLike): boolean => {
    if (selector.startsWith('#')) return candidate.attributes.id === selector.slice(1);
    if (selector.startsWith('.')) {
      return (candidate.attributes.class ?? '').split(/\s+/).includes(selector.slice(1));
    }
    return candidate.tagName.toLowerCase() === selector.toLowerCase();
  };
  if (matches(node)) return node;
  for (const child of node.children ?? []) {
    const found = findBySelector(child, selector);
    if (found) return found;
  }
  return null;
}

function textOf(node: SnapshotElementLike): string {
  const own = String(node.textContent ?? '').trim();
  const children = (node.children ?? []).map(textOf).filter(Boolean);
  return [own, ...children].filter(Boolean).join('\n');
}

/**
 * The only branching logic in the extension, kept here so it runs under the
 * `packages/browser` suites - `scripts/test.mjs` never scans `apps/extension`.
 */
export async function handleExtensionCommand(
  registry: RefRegistry,
  bridge: ExtensionBridge,
  command: ExtensionCommand,
): Promise<unknown> {
  const params = command.params ?? {};
  if (command.op === 'tabs') return bridge.listTabs();
  if (command.op === 'navigate') {
    return bridge.navigate(
      String(params.url),
      params.waitUntil === 'idle' ? 'idle' : 'load',
      params.tabId,
    );
  }
  if (command.op === 'snapshot') return snapshot(registry, bridge, params);
  if (command.op === 'act') return act(registry, bridge, params);
  if (command.op === 'logs') {
    return bridge.logs(
      params.logKind === 'network' ? 'network' : 'console',
      Number(params.limit ?? 50),
      params.tabId,
    );
  }
  if (command.op === 'read') {
    const tabs = await bridge.listTabs();
    const tab = params.tabId
      ? tabs.find((entry) => entry.tabId === params.tabId)
      : tabs.find((entry) => entry.active);
    const root = await bridge.serialize(params.tabId);
    // Scoped like the CDP transport: handing back the whole document when the
    // caller named one element would return far more of the page than asked.
    let scoped: SnapshotElementLike | null = root;
    if (params.ref) scoped = registry.resolve(String(params.ref));
    else if (params.selector) scoped = findBySelector(root, String(params.selector));
    if (!scoped) {
      throw Object.assign(new Error(`No element matches ${String(params.selector)}`), {
        code: 'NOT_FOUND',
      });
    }
    return { tabId: tab?.tabId ?? '', url: tab?.url ?? '', content: textOf(scoped) };
  }
  throw new Error(`unsupported browser operation: ${String((command as any).op)}`);
}
