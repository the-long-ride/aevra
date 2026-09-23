import { randomUUID } from 'node:crypto';
import type {
  ControlAction,
  ControlCapabilities,
  ControlMode,
  ControlObservation,
  ControlTarget,
} from '../../protocol/src/control.js';
import type { BrowserSnapshotNode } from '../../protocol/src/browser.js';
import { ControlAdapterError, type ControlDispatchReceipt } from '../../control/src/adapter.js';
import {
  BaseAdapter,
  mapBrowserNode,
  pendingApproval,
  throwPending,
  workspaceArgs,
} from './control-adapter-base.js';
import type { McpRuntimeContext } from './service-types.js';

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

  forSession(sessionId: string): McpBrowserControlAdapter {
    if (sessionId === this.sessionId) return this;
    const rebound = new McpBrowserControlAdapter(
      this.context,
      sessionId,
      this.resolvedTabId,
      this.mode,
      this.maxNodes,
    );
    rebound.inheritObservationState(this);
    rebound.resolvedTabId = this.resolvedTabId;
    rebound.surfaceId = this.surfaceId;
    return rebound;
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
