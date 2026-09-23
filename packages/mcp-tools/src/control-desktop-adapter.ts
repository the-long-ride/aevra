import { randomUUID } from 'node:crypto';
import type {
  ControlAction,
  ControlCapabilities,
  ControlMode,
  ControlNode,
  ControlObservation,
  ControlTarget,
} from '../../protocol/src/control.js';
import type { DesktopNode } from '../../protocol/src/desktop.js';
import { ControlAdapterError, type ControlDispatchReceipt } from '../../control/src/adapter.js';
import {
  BaseAdapter,
  mapDesktopNode,
  pendingApproval,
  throwPending,
  workspaceArgs,
} from './control-adapter-base.js';
import type { McpRuntimeContext } from './service-types.js';

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

  forSession(sessionId: string): McpDesktopControlAdapter {
    if (sessionId === this.sessionId) return this;
    const rebound = new McpDesktopControlAdapter(
      this.context,
      sessionId,
      this.windowId,
      this.mode,
      this.maxNodes,
    );
    rebound.inheritObservationState(this);
    rebound.lastSnapshot = this.lastSnapshot ? structuredClone(this.lastSnapshot) : undefined;
    return rebound;
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
