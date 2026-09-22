import { randomUUID } from 'node:crypto';
import type {
  ControlAction,
  ControlActionKind,
  ControlCapabilities,
  ControlMode,
  ControlNode,
  ControlObservation,
  ControlTarget,
} from '../../protocol/src/control.js';
import type { BrowserSnapshotNode } from '../../protocol/src/browser.js';
import type { DesktopNode } from '../../protocol/src/desktop.js';
import {
  ControlAdapterError,
  type ControlAdapter,
  type ControlDispatchReceipt,
} from '../../control/src/adapter.js';
import type { McpRuntimeContext } from './service-types.js';

function workspaceArgs(context: McpRuntimeContext) {
  return context.workspaceId ? { workspaceId: context.workspaceId } : {};
}

function pendingApproval(value: any): boolean {
  return value?.status === 'approval_pending';
}

function throwPending(value: any): never {
  throw new ControlAdapterError(
    'CONTROL_APPROVAL_REQUIRED',
    `Approval ${value?.requestId ?? 'is'} pending`,
    'notDispatched',
    'needsApproval',
  );
}

function desktopActions(node: DesktopNode): ControlActionKind[] {
  const actions = new Set<ControlActionKind>();
  for (const action of node.supportedActions ?? []) {
    if (action === 'invoke') {
      actions.add('invoke');
      actions.add('click');
    } else if (action === 'setValue') {
      actions.add('setValue');
      actions.add('type');
    } else if (action === 'select') {
      actions.add('select');
    } else if (action === 'toggle') {
      actions.add('setToggleState');
    }
  }
  return [...actions];
}

function mapDesktopNode(node: DesktopNode, parentRef?: string): ControlNode {
  return {
    ref: node.ref,
    role: node.role,
    name: node.name,
    ...(node.value === undefined ? {} : { value: node.value }),
    enabled: node.enabled,
    ...(node.toggleState ? { toggleState: node.toggleState } : {}),
    actions: desktopActions(node),
    ...(parentRef ? { parentRef } : {}),
    ...(node.children
      ? { children: node.children.map((child) => mapDesktopNode(child, node.ref)) }
      : {}),
  };
}

function browserActions(node: BrowserSnapshotNode): ControlActionKind[] {
  const actions = new Set<ControlActionKind>(['wait_for']);
  if (!node.disabled) {
    actions.add('click');
    if (['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(node.role)) actions.add('type');
    if (['combobox', 'listbox', 'option'].includes(node.role)) actions.add('select');
  }
  return [...actions];
}

function mapBrowserNode(node: BrowserSnapshotNode, parentRef?: string): ControlNode {
  return {
    ref: node.ref,
    role: node.role,
    name: node.name,
    ...(node.value === undefined ? {} : { value: node.value }),
    enabled: !node.disabled,
    actions: browserActions(node),
    ...(parentRef ? { parentRef } : {}),
    ...(node.children
      ? { children: node.children.map((child) => mapBrowserNode(child, node.ref)) }
      : {}),
  };
}

abstract class BaseAdapter implements ControlAdapter {
  protected revision = 0;
  protected generation = 1;
  protected lastFingerprint = '';
  protected lastObservation?: ControlObservation;
  abstract surfaceId: string;
  abstract readonly mode: ControlMode;
  abstract capabilities(): ControlCapabilities;
  abstract observe(): Promise<ControlObservation>;
  abstract dispatch(
    target: ControlTarget,
    action: ControlAction,
    timeoutMs: number,
  ): Promise<ControlDispatchReceipt>;

  protected observation(
    fingerprint: string,
    create: (revision: number, now: string) => ControlObservation,
  ): ControlObservation {
    if (fingerprint === this.lastFingerprint && this.lastObservation) {
      return structuredClone(this.lastObservation);
    }
    this.revision++;
    this.lastFingerprint = fingerprint;
    const observation = create(this.revision, new Date().toISOString());
    this.lastObservation = structuredClone(observation);
    return observation;
  }
}

export class McpDesktopControlAdapter extends BaseAdapter {
  surfaceId: string;
  private lastSnapshot:
    { snapshotId: string; windowLeaseId: string; nodes: ControlNode[] } | undefined;

  constructor(
    private readonly context: McpRuntimeContext,
    private readonly sessionId: string,
    private readonly windowId: string,
    readonly mode: ControlMode,
    private readonly maxNodes = 2000,
  ) {
    super();
    this.surfaceId = `desktop:${windowId}`;
    if (mode !== 'sharedSemantic') {
      throw new ControlAdapterError(
        'CONTROL_ISOLATION_UNAVAILABLE',
        'This worker has no verified isolated desktop runner bound to the requested surface',
        'notDispatched',
        'chooseIsolatedRunner',
      );
    }
  }

  capabilities(): ControlCapabilities {
    return {
      semantic: true,
      isolation: 'shared',
      capture: false,
      watch: false,
      attribution: true,
      actions: ['click', 'type', 'invoke', 'setValue', 'select', 'setToggleState', 'wait_for'],
      limitations: [
        'Shared semantic mode uses provider actions only; host cursor, keyboard, clipboard, and focus synthesis are not used.',
        'Native event streaming is not yet available, so each step performs a bounded live refresh.',
      ],
    };
  }

  async observe(): Promise<ControlObservation> {
    const value: any = await this.context.callInner(this.sessionId, 'desktop_describe', {
      ...workspaceArgs(this.context),
      windowId: this.windowId,
      mode: 'background',
      maxNodes: this.maxNodes,
      interactiveOnly: false,
    });
    if (!value?.snapshotId || !value?.windowLeaseId) {
      throw new ControlAdapterError(
        'CONTROL_DESKTOP_OBSERVE_FAILED',
        'Background desktop observation did not return a snapshot lease',
        'notDispatched',
        'needsContext',
      );
    }
    const nodes = (value.nodes ?? []).map((node: DesktopNode) => mapDesktopNode(node));
    const fingerprint = JSON.stringify(nodes);
    this.lastSnapshot = {
      snapshotId: String(value.snapshotId),
      windowLeaseId: String(value.windowLeaseId),
      nodes,
    };
    return this.observation(fingerprint, (revision, now) => ({
      observationId: `obs_${randomUUID()}`,
      surfaceId: this.surfaceId,
      generation: this.generation,
      revision,
      freshness: 'fresh',
      watchHealth: 'degraded',
      observedAt: now,
      lastValidatedAt: now,
      policyRevision: 0,
      mode: this.mode,
      coverage: {
        scope: 'surface',
        truncated: Boolean(value.truncated),
        omittedNodes: 0,
      },
      nodes,
    }));
  }

  async dispatch(
    target: ControlTarget,
    action: ControlAction,
    _timeoutMs: number,
  ): Promise<ControlDispatchReceipt> {
    if (!('ref' in target)) {
      throw new ControlAdapterError(
        'CONTROL_TARGET_INVALID',
        'Desktop dispatch requires a resolved ref',
      );
    }
    const snapshot = this.lastSnapshot;
    if (!snapshot) {
      throw new ControlAdapterError(
        'CONTROL_OBSERVATION_STALE',
        'Desktop target has no current snapshot',
        'notDispatched',
        'refresh',
      );
    }
    const node = snapshot.nodes.find((candidate) => candidate.ref === target.ref);
    if (!node) {
      throw new ControlAdapterError(
        'CONTROL_REF_STALE',
        'Desktop ref is no longer current',
        'notDispatched',
        'refresh',
      );
    }
    if (action.op === 'wait_for') return { dispatched: false, outcome: 'alreadySatisfied' };
    if (action.op === 'setToggleState' && node.toggleState === action.state) {
      return { dispatched: false, outcome: 'alreadySatisfied' };
    }

    const common = {
      ...workspaceArgs(this.context),
      windowId: this.windowId,
      windowLeaseId: snapshot.windowLeaseId,
      snapshotId: snapshot.snapshotId,
      ref: target.ref,
    };
    let tool: string;
    let args: any = common;
    if (action.op === 'invoke' || action.op === 'click') {
      tool = 'desktop_invoke';
    } else if (action.op === 'setValue') {
      tool = 'desktop_set_value';
      args = { ...common, value: action.value };
    } else if (action.op === 'type') {
      tool = 'desktop_set_value';
      args = { ...common, value: action.text };
    } else if (action.op === 'select') {
      tool = 'desktop_select';
    } else if (action.op === 'setToggleState') {
      tool = 'desktop_toggle';
    } else {
      throw new ControlAdapterError(
        'CONTROL_ACTION_UNSUPPORTED',
        `Desktop shared-semantic mode does not support ${action.op}`,
      );
    }

    try {
      const result = await this.context.callInner(this.sessionId, tool, args);
      if (pendingApproval(result)) throwPending(result);
      this.lastSnapshot = undefined;
      if (result?.postActionStateUnknown) {
        throw new ControlAdapterError(
          'CONTROL_OUTCOME_UNKNOWN',
          'Desktop provider acknowledged the action but post-action state is unknown',
          'unknown',
          'inspectOutcome',
        );
      }
      if (result?.focusChanged) {
        throw new ControlAdapterError(
          'CONTROL_CONTEXT_CHANGED',
          'Desktop focus changed while the semantic action was executing',
          'dispatched',
          'needsContext',
        );
      }
      return { dispatched: true, outcome: 'completed' };
    } catch (error) {
      if (error instanceof ControlAdapterError) throw error;
      const value = error as { code?: string; message?: string };
      throw new ControlAdapterError(
        value?.code ?? 'CONTROL_DESKTOP_DISPATCH_FAILED',
        value?.message ?? String(error),
        value?.code === 'DESKTOP_OUTCOME_UNKNOWN' ? 'unknown' : 'notDispatched',
        value?.code === 'DESKTOP_OUTCOME_UNKNOWN' ? 'inspectOutcome' : 'none',
      );
    }
  }
}

export class McpBrowserControlAdapter extends BaseAdapter {
  surfaceId: string;
  private resolvedTabId?: string;

  constructor(
    private readonly context: McpRuntimeContext,
    private readonly sessionId: string,
    tabId: string | undefined,
    readonly mode: ControlMode,
    private readonly maxNodes = 2000,
  ) {
    super();
    this.resolvedTabId = tabId;
    this.surfaceId = `browser:${tabId ?? 'active'}`;
    if (mode !== 'sharedSemantic') {
      throw new ControlAdapterError(
        'CONTROL_ISOLATION_UNAVAILABLE',
        'No verified isolated browser runner is bound to this request',
        'notDispatched',
        'chooseIsolatedRunner',
      );
    }
  }

  capabilities(): ControlCapabilities {
    return {
      semantic: true,
      isolation: 'shared',
      capture: true,
      watch: false,
      attribution: true,
      actions: ['click', 'type', 'press_key', 'scroll', 'select', 'wait_for', 'invoke'],
      limitations: [
        'Navigation remains an explicit browser_navigate operation and is not implicit in control plans.',
      ],
    };
  }

  async observe(): Promise<ControlObservation> {
    const value: any = await this.context.callInner(this.sessionId, 'browser_snapshot', {
      ...workspaceArgs(this.context),
      ...(this.resolvedTabId ? { tabId: this.resolvedTabId } : {}),
      mode: 'a11y',
      maxNodes: this.maxNodes,
    });
    this.resolvedTabId = String(value.tabId ?? this.resolvedTabId ?? '');
    if (!this.resolvedTabId) {
      throw new ControlAdapterError(
        'CONTROL_BROWSER_OBSERVE_FAILED',
        'Browser snapshot returned no tab id',
      );
    }
    this.surfaceId = `browser:${this.resolvedTabId}`;
    const nodes = (value.nodes ?? []).map((node: BrowserSnapshotNode) => mapBrowserNode(node));
    const fingerprint = JSON.stringify([value.url, nodes]);
    const generation = Number(value.snapshotVersion ?? this.generation);
    if (generation !== this.generation) {
      this.generation = generation;
      this.lastFingerprint = '';
      this.lastObservation = undefined;
    }
    return this.observation(fingerprint, (revision, now) => ({
      observationId: `obs_${randomUUID()}`,
      surfaceId: this.surfaceId,
      generation: this.generation,
      revision,
      url: String(value.url ?? ''),
      freshness: 'fresh',
      watchHealth: 'degraded',
      observedAt: now,
      lastValidatedAt: now,
      policyRevision: 0,
      mode: this.mode,
      coverage: { scope: 'surface', truncated: Boolean(value.truncated), omittedNodes: 0 },
      nodes,
    }));
  }

  async dispatch(
    target: ControlTarget,
    action: ControlAction,
    timeoutMs: number,
  ): Promise<ControlDispatchReceipt> {
    if (!('ref' in target)) {
      throw new ControlAdapterError(
        'CONTROL_TARGET_INVALID',
        'Browser dispatch requires a resolved ref',
      );
    }
    let browserAction: any;
    if (action.op === 'invoke' || action.op === 'click')
      browserAction = { op: 'click', ref: target.ref };
    else if (action.op === 'type')
      browserAction = { op: 'type', ref: target.ref, text: action.text, clear: action.clear };
    else if (action.op === 'setValue')
      browserAction = { op: 'type', ref: target.ref, text: action.value, clear: true };
    else if (action.op === 'press_key') browserAction = { op: 'press_key', key: action.key };
    else if (action.op === 'scroll')
      browserAction = { op: 'scroll', ref: target.ref, dx: action.dx, dy: action.dy };
    else if (action.op === 'select')
      browserAction = { op: 'select', ref: target.ref, value: action.value };
    else if (action.op === 'wait_for')
      browserAction = {
        op: 'wait_for',
        ref: target.ref,
        text: action.text,
        timeoutMs: Math.min(timeoutMs, action.timeoutMs),
      };
    else {
      throw new ControlAdapterError(
        'CONTROL_ACTION_UNSUPPORTED',
        `Browser control does not support ${action.op}`,
      );
    }

    const result: any = await this.context.callInner(this.sessionId, 'browser_act_many', {
      ...workspaceArgs(this.context),
      ...(this.resolvedTabId ? { tabId: this.resolvedTabId } : {}),
      actions: [browserAction],
      stopOnError: true,
    });
    if (pendingApproval(result)) throwPending(result);
    const actionResult = Array.isArray(result) ? result[0] : (result?.result?.[0] ?? result?.[0]);
    if (actionResult && actionResult.ok === false) {
      throw new ControlAdapterError(
        actionResult.error?.code ?? 'CONTROL_BROWSER_DISPATCH_FAILED',
        actionResult.error?.message ?? actionResult.detail ?? 'Browser action failed',
      );
    }
    return { dispatched: action.op !== 'wait_for', outcome: 'completed' };
  }
}
