import { ContextComposer } from '../../control/src/context-composer.js';
import { PlanExecutor } from '../../control/src/plan-executor.js';
import { ControlPlanJournal } from '../../control/src/plan-journal.js';
import type { ControlAdapter } from '../../control/src/adapter.js';
import { parseControlPlan } from '../../protocol/src/control-parse.js';
import {
  type ControlAction,
  type ControlMode,
  type ControlPlan,
  type ControlPredicate,
  type ControlTarget,
} from '../../protocol/src/control.js';
import { redactText } from '../../security/src/dlp.js';
import { markUntrusted } from '../../security/src/untrusted.js';
import { AevraToolError } from './errors.js';
import { requiredLease } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';
import { McpBrowserControlAdapter, McpDesktopControlAdapter } from './control-adapters.js';

export const CONTROL_TOOL_NAMES = new Set([
  'control_observe',
  'control_execute',
  'control_plan_status',
  'control_plan_cancel',
  'desktop_act_many',
]);

const composer = new ContextComposer();
const executors = new WeakMap<object, PlanExecutor>();
const surfaces = new Map<string, Map<string, ControlAdapter>>();

function executorFor(context: McpRuntimeContext): PlanExecutor {
  const key = context.deps as object;
  let executor = executors.get(key);
  if (!executor) {
    executor = new PlanExecutor(undefined, new ControlPlanJournal(context.deps.controlPlans));
    executors.set(key, executor);
  }
  return executor;
}

function owner(context: McpRuntimeContext, sessionId: string): string {
  const lease = requiredLease(context, sessionId);
  const identity =
    typeof (context.sessions as any).connectionIdentity === 'function'
      ? (context.sessions as any).connectionIdentity(sessionId)
      : undefined;
  const connectionId = identity?.connectionId ?? sessionId;
  return `${connectionId}:${lease.workspaceId}`;
}

function ownerSurfaces(ownerKey: string): Map<string, ControlAdapter> {
  let entries = surfaces.get(ownerKey);
  if (!entries) {
    entries = new Map();
    surfaces.set(ownerKey, entries);
  }
  return entries;
}

function adapterForSession(adapter: ControlAdapter, sessionId: string): ControlAdapter {
  if (adapter instanceof McpBrowserControlAdapter || adapter instanceof McpDesktopControlAdapter) {
    return adapter.forSession(sessionId);
  }
  return adapter;
}

function maxNodesFromTokens(value: unknown): number {
  const tokens = Number(value ?? 2000);
  if (!Number.isFinite(tokens)) return 160;
  return Math.max(1, Math.min(2000, Math.floor(tokens / 12)));
}

async function observe(context: McpRuntimeContext, sessionId: string, args: any) {
  const ownerKey = owner(context, sessionId);
  const mode: ControlMode = args.mode === 'isolated' ? 'isolated' : 'sharedSemantic';
  const kind = args.kind === 'browser' ? 'browser' : 'desktop';
  const windowId = String(args.windowId ?? '');
  if (kind === 'desktop' && !windowId) {
    throw new AevraToolError('INVALID_REQUEST', 'control_observe desktop mode requires windowId');
  }
  const adapter =
    kind === 'browser'
      ? new McpBrowserControlAdapter(
          context,
          sessionId,
          args.tabId === undefined ? undefined : String(args.tabId),
          mode,
        )
      : new McpDesktopControlAdapter(context, sessionId, windowId, mode);
  let observation = await adapter.observe();
  const previous = executorFor(context).observations.get(ownerKey, observation.surfaceId);
  if (
    previous &&
    observation.observationId !== previous.observationId &&
    observation.generation === previous.generation &&
    observation.revision <= previous.revision
  ) {
    adapter.advanceAfter(previous);
    observation = await adapter.observe();
  }
  ownerSurfaces(ownerKey).set(observation.surfaceId, adapter);
  executorFor(context).observations.record(ownerKey, observation);
  const projected = composer.compose(observation, {
    maxNodes: maxNodesFromTokens(args.maxOutputTokens),
    interactiveOnly: args.detail !== 'full',
  });
  return markUntrusted({
    observation: projected,
    capabilities: adapter.capabilities(),
    includeImage: false,
    ...(args.includeImage
      ? {
          imageNotice:
            'Image delivery is not embedded in control observations yet; use browser_snapshot vision or desktop_capture explicitly.',
        }
      : {}),
  });
}

async function execute(context: McpRuntimeContext, sessionId: string, rawPlan: unknown) {
  const ownerKey = owner(context, sessionId);
  const plan = parseControlPlan(rawPlan);
  refuseSecretPlanData(plan);
  const known = ownerSurfaces(ownerKey);
  const adapters = new Map<string, ControlAdapter>();
  for (const surfaceId of plan.surfaceIds) {
    const adapter = known.get(surfaceId);
    if (adapter) {
      const currentAdapter = adapterForSession(adapter, sessionId);
      known.set(surfaceId, currentAdapter);
      adapters.set(surfaceId, currentAdapter);
    }
  }
  const result = await executorFor(context).execute(ownerKey, plan, adapters);
  context.deps.audit?.append({
    sessionId,
    workspaceId: requiredLease(context, sessionId).workspaceId,
    tool: 'control_execute',
    operation: 'control:execute',
    target: plan.surfaceIds.join(','),
    risk: 'MEDIUM',
    result: result.status === 'completed' ? 'SUCCEEDED' : 'FAILED',
    redactionCount: 0,
  });
  return markUntrusted(result);
}

function refuseSecretPlanData(plan: ControlPlan): void {
  for (const step of plan.steps) {
    const value =
      step.action.op === 'type'
        ? step.action.text
        : step.action.op === 'setValue' || step.action.op === 'select'
          ? step.action.value
          : undefined;
    if (typeof value === 'string' && value && redactText(value).redactionCount > 0) {
      throw new AevraToolError(
        'INVALID_REQUEST',
        `Aevra will not send secret-shaped data through a control plan (${step.action.op})`,
      );
    }
  }
}

function controlTarget(input: any): ControlTarget {
  if (typeof input?.ref === 'string' && input.ref) return { ref: input.ref };
  const locator = input?.locator;
  if (!locator || typeof locator.role !== 'string' || typeof locator.name !== 'string') {
    throw new AevraToolError(
      'INVALID_REQUEST',
      'Each desktop batch action requires ref or locator',
    );
  }
  return {
    locator: {
      scope: locator.scope === 'subtree' ? 'subtree' : 'surface',
      role: locator.role,
      name: locator.name,
      match: 'exact',
      requireUnique: true,
      ...(locator.observedAncestor ? { observedAncestor: String(locator.observedAncestor) } : {}),
    },
  };
}

function controlAction(input: any): ControlAction {
  switch (input?.op) {
    case 'invoke':
      return { op: 'invoke' };
    case 'click':
      return { op: 'click' };
    case 'setValue':
      return { op: 'setValue', value: String(input.value ?? '') };
    case 'type':
      return { op: 'type', text: String(input.text ?? ''), clear: input.clear !== false };
    case 'select':
      return { op: 'select', value: String(input.value ?? '') };
    case 'setToggleState':
      return { op: 'setToggleState', state: input.state === 'off' ? 'off' : 'on' };
    default:
      throw new AevraToolError('INVALID_REQUEST', `Unsupported desktop batch action: ${input?.op}`);
  }
}

function defaultPostcondition(action: ControlAction): ControlPredicate {
  if (action.op === 'setValue') return { kind: 'valueEquals', value: action.value };
  if (action.op === 'type') return { kind: 'valueEquals', value: action.text };
  if (action.op === 'setToggleState') return { kind: 'toggleStateEquals', state: action.state };
  return { kind: 'enabled', equals: true };
}

async function desktopActMany(context: McpRuntimeContext, sessionId: string, args: any) {
  if (!Array.isArray(args.actions) || args.actions.length === 0) {
    throw new AevraToolError('INVALID_REQUEST', 'desktop_act_many requires at least one action');
  }
  const windowId = String(args.windowId ?? '');
  if (!windowId) throw new AevraToolError('INVALID_REQUEST', 'desktop_act_many requires windowId');
  const ownerKey = owner(context, sessionId);
  const adapter = new McpDesktopControlAdapter(context, sessionId, windowId, 'sharedSemantic');
  const baseline = await adapter.observe();
  executorFor(context).observations.record(ownerKey, baseline);
  ownerSurfaces(ownerKey).set(baseline.surfaceId, adapter);

  const steps = args.actions.map((input: any, index: number) => {
    const action = controlAction(input);
    return {
      id: String(input.id ?? `step_${index + 1}`),
      surfaceId: baseline.surfaceId,
      dependsOn:
        index > 0 && args.stopOnError !== false
          ? [String(args.actions[index - 1]?.id ?? `step_${index}`)]
          : [],
      target: controlTarget(input),
      action,
      preconditions: Array.isArray(input.preconditions)
        ? input.preconditions
        : [{ kind: 'enabled', equals: true }],
      postcondition: input.postcondition ?? defaultPostcondition(action),
      timeoutMs: Math.max(50, Math.min(30_000, Number(input.timeoutMs ?? 5000))),
    };
  });

  const plan: ControlPlan = parseControlPlan({
    schemaVersion: 1,
    requestId: String(args.requestId ?? `desktop-batch-${Date.now()}`),
    surfaceIds: [baseline.surfaceId],
    expectedObservations: { [baseline.surfaceId]: baseline.observationId },
    mode: 'sharedSemantic',
    deadlineMs: Math.max(1000, Math.min(60_000, Number(args.deadlineMs ?? 30_000))),
    maxConcurrency: 1,
    steps,
    output: {
      kind: 'delta',
      baseObservationId: baseline.observationId,
      maxOutputTokens: Math.max(1, Math.min(4000, Number(args.maxOutputTokens ?? 1000))),
    },
  });
  return execute(context, sessionId, plan);
}

export async function handleControlTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  if (!CONTROL_TOOL_NAMES.has(name)) {
    throw new AevraToolError('CAPABILITY_REQUIRED', `Tool ${name} is not enabled`);
  }
  if (name === 'control_observe') return observe(context, sessionId, args);
  if (name === 'control_execute') return execute(context, sessionId, args.plan);
  if (name === 'desktop_act_many') return desktopActMany(context, sessionId, args);

  const ownerKey = owner(context, sessionId);
  const planId = String(args.planId ?? '');
  if (!planId) throw new AevraToolError('INVALID_REQUEST', `${name} requires planId`);
  if (name === 'control_plan_cancel') {
    const cancelled = executorFor(context).cancel(ownerKey, planId);
    if (!cancelled) throw new AevraToolError('NOT_FOUND', 'Control plan not found');
    return { planId, cancelled: true };
  }
  const record = executorFor(context).status(ownerKey, planId);
  if (!record) throw new AevraToolError('NOT_FOUND', 'Control plan not found');
  return {
    planId: record.planId,
    requestId: record.requestId,
    status: record.status,
    cancelled: record.cancelled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.result ? { result: markUntrusted(record.result) } : {}),
  };
}
