// Shared plumbing for the MCP-backed control adapters: node mapping and observation caching.
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

export function workspaceArgs(context: McpRuntimeContext) {
  return context.workspaceId ? { workspaceId: context.workspaceId } : {};
}

export function pendingApproval(value: any): boolean {
  return value?.status === 'approval_pending';
}

export function throwPending(value: any): never {
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

export function mapDesktopNode(node: DesktopNode, parentRef?: string): ControlNode {
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

export function mapBrowserNode(node: BrowserSnapshotNode, parentRef?: string): ControlNode {
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

export abstract class BaseAdapter implements ControlAdapter {
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

  inheritObservationState(source: BaseAdapter): void {
    this.revision = source.revision;
    this.generation = source.generation;
    this.lastFingerprint = source.lastFingerprint;
    this.lastObservation = source.lastObservation
      ? structuredClone(source.lastObservation)
      : undefined;
  }

  advanceAfter(observation: ControlObservation): void {
    if (observation.generation !== this.generation) return;
    this.revision = Math.max(this.revision, observation.revision);
    this.lastFingerprint = '';
    this.lastObservation = undefined;
  }

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
