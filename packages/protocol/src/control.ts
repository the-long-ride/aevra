export const CONTROL_SCHEMA_VERSION = 1 as const;
export const CONTROL_MAX_STEPS = 32;
export const CONTROL_MAX_SURFACES = 8;
export const CONTROL_MAX_DEADLINE_MS = 60_000;
export const CONTROL_MAX_CONCURRENCY = 4;

export type ControlMode = 'sharedSemantic' | 'isolated';
export type ControlSurfaceKind = 'browser' | 'desktop';
export type ControlFreshness = 'fresh' | 'dirty' | 'expired' | 'unknown';
export type ControlWatchHealth = 'healthy' | 'degraded' | 'lost';
export type ControlDispatchState = 'notDispatched' | 'dispatched' | 'unknown';
export type ControlRecovery =
  'refresh' | 'needsContext' | 'needsApproval' | 'chooseIsolatedRunner' | 'inspectOutcome' | 'none';

export type ControlActionKind =
  | 'click'
  | 'type'
  | 'press_key'
  | 'scroll'
  | 'wait_for'
  | 'invoke'
  | 'setValue'
  | 'select'
  | 'setToggleState';

export type ControlAction =
  | { op: 'click' }
  | { op: 'type'; text: string; clear?: boolean }
  | { op: 'press_key'; key: string }
  | { op: 'scroll'; dx: number; dy: number }
  | { op: 'wait_for'; text?: string; timeoutMs: number }
  | { op: 'invoke' }
  | { op: 'setValue'; value: string }
  | { op: 'select'; value: string }
  | { op: 'setToggleState'; state: 'off' | 'on' };

export interface ControlLocator {
  scope: 'surface' | 'subtree';
  role: string;
  name: string;
  match: 'exact';
  requireUnique: true;
  observedAncestor?: string;
}

export type ControlTarget = { ref: string } | { locator: ControlLocator };

export type ControlPredicate =
  | { kind: 'enabled'; equals: boolean }
  | { kind: 'valueEquals'; value: string }
  | { kind: 'textPresent'; scope: 'surface' | 'subtree'; text: string }
  | { kind: 'toggleStateEquals'; state: 'off' | 'on' | 'indeterminate' }
  | { kind: 'elementAbsent'; scope: 'surface' | 'subtree'; role?: string; name?: string }
  | { kind: 'urlEquals'; url: string };

export interface ControlNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  enabled?: boolean;
  toggleState?: 'off' | 'on' | 'indeterminate';
  actions: ControlActionKind[];
  parentRef?: string;
  childRefs?: string[];
  children?: ControlNode[];
}

export interface ControlCoverage {
  scope: 'surface' | 'subtree' | 'node';
  truncated: boolean;
  omittedNodes: number;
  expansionHandle?: string;
}

export interface ControlCapabilities {
  semantic: boolean;
  isolation: 'shared' | 'isolated' | 'unsupported';
  capture: boolean;
  watch: boolean;
  attribution: boolean;
  actions: ControlActionKind[];
  limitations: string[];
}

export interface ControlSurface {
  surfaceId: string;
  kind: ControlSurfaceKind;
  label: string;
  generation: number;
  capabilities: ControlCapabilities;
}

export interface ControlObservation {
  observationId: string;
  surfaceId: string;
  generation: number;
  revision: number;
  url?: string;
  freshness: ControlFreshness;
  watchHealth: ControlWatchHealth;
  observedAt: string;
  lastValidatedAt: string;
  policyRevision: number;
  mode: ControlMode;
  coverage: ControlCoverage;
  nodes: ControlNode[];
  image?: {
    dataUri: string;
    capturedAt: string;
    devicePixelRatio: number;
    viewport: { x: number; y: number; width: number; height: number };
  };
}

export interface ControlDelta {
  kind: 'delta';
  baseObservationId: string;
  observationId: string;
  appliedObservationId: string;
  surfaceId: string;
  revision: number;
  freshness: ControlFreshness;
  watchHealth: ControlWatchHealth;
  upsert: ControlNode[];
  remove: string[];
  complete: boolean;
  continuation?: ControlDeltaContinuation;
  metadata: ControlDeltaMetadata;
  truncated: boolean;
  coverage: ControlCoverage;
}

export interface ControlFullObservation {
  kind: 'full';
  observation: ControlObservation;
  complete: boolean;
  appliedObservationId?: string;
  continuation?: ControlDeltaContinuation;
}

export interface ControlDeltaContinuation {
  token: string;
  baseObservationId: string;
  observationId: string;
  offset: number;
  totalChanges: number;
}

export interface ControlDeltaMetadata {
  generation: number;
  policyRevision: number;
  mode: ControlMode;
  observedAt: string;
  lastValidatedAt: string;
  image?: ControlObservation['image'] | null;
  imageChanged: boolean;
}

export type ControlObservationResult = ControlDelta | ControlFullObservation;

export interface ControlStep {
  id: string;
  surfaceId: string;
  dependsOn: string[];
  target: ControlTarget;
  action: ControlAction;
  preconditions: ControlPredicate[];
  postcondition: ControlPredicate;
  timeoutMs: number;
}

export interface ControlPlanOutput {
  kind: 'delta' | 'full';
  baseObservationId?: string;
  maxOutputTokens: number;
}

export interface ControlPlan {
  schemaVersion: typeof CONTROL_SCHEMA_VERSION;
  requestId: string;
  surfaceIds: string[];
  expectedObservations: Record<string, string>;
  mode: ControlMode;
  deadlineMs: number;
  maxConcurrency: number;
  steps: ControlStep[];
  output: ControlPlanOutput;
}

export type ControlStepStatus =
  | 'notStarted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'skipped'
  | 'cancelled'
  | 'awaitingApproval'
  | 'needsContext';

export interface ControlPlanStepResult {
  id: string;
  status: ControlStepStatus;
  postcondition: 'matched' | 'notMatched' | 'notChecked';
}

export interface ControlError {
  code: string;
  stepId?: string;
  dispatchState: ControlDispatchState;
  recovery: ControlRecovery;
  observationId?: string;
  message: string;
}

export interface ControlCheckpoint {
  reason: 'needsContext' | 'needsApproval' | 'chooseIsolatedRunner' | 'inspectOutcome';
  observation?: ControlObservationResult;
  nextAction: string;
}

export interface ControlPlanResult {
  planId: string;
  status: 'completed' | 'failed' | 'partial' | 'cancelled' | 'awaitingApproval' | 'needsContext';
  steps: ControlPlanStepResult[];
  observation?: ControlObservationResult;
  error?: ControlError;
  checkpoint?: ControlCheckpoint;
}

class ControlContractError extends Error {
  constructor(message: string) {
    super(`CONTROL_INVALID_PLAN: ${message}`);
    this.name = 'ControlContractError';
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ControlContractError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new ControlContractError(`Unknown key at ${path}.${key}`);
  }
}

function text(value: unknown, path: string, maxLength = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ControlContractError(
      `${path} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  return value;
}

function stringValue(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ControlContractError(`${path} must be a string of at most ${maxLength} characters`);
  }
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ControlContractError(`${path} must be between ${min} and ${max}`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ControlContractError(`${path} must be a boolean`);
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new ControlContractError(`${path} has an unsupported value`);
  }
  return value as T;
}

function parseAction(value: unknown, path: string): ControlAction {
  const input = record(value, path);
  if (typeof input.op !== 'string') throw new ControlContractError(`${path}.op is required`);
  switch (input.op) {
    case 'click':
      keys(input, ['op'], path);
      return { op: 'click' };
    case 'type':
      keys(input, ['op', 'text', 'clear'], path);
      return {
        op: 'type',
        text: stringValue(input.text, `${path}.text`, 65_536),
        ...(input.clear === undefined ? {} : { clear: boolean(input.clear, `${path}.clear`) }),
      };
    case 'press_key':
      keys(input, ['op', 'key'], path);
      return { op: 'press_key', key: text(input.key, `${path}.key`, 128) };
    case 'scroll':
      keys(input, ['op', 'dx', 'dy'], path);
      if (
        typeof input.dx !== 'number' ||
        !Number.isFinite(input.dx) ||
        typeof input.dy !== 'number' ||
        !Number.isFinite(input.dy)
      ) {
        throw new ControlContractError(`${path}.dx and ${path}.dy must be finite numbers`);
      }
      return { op: 'scroll', dx: input.dx, dy: input.dy };
    case 'wait_for':
      keys(input, ['op', 'text', 'timeoutMs'], path);
      return {
        op: 'wait_for',
        ...(input.text === undefined ? {} : { text: text(input.text, `${path}.text`) }),
        timeoutMs: integer(input.timeoutMs, `${path}.timeoutMs`, 1, CONTROL_MAX_DEADLINE_MS),
      };
    case 'invoke':
      keys(input, ['op'], path);
      return { op: 'invoke' };
    case 'setValue':
      keys(input, ['op', 'value'], path);
      return { op: 'setValue', value: stringValue(input.value, `${path}.value`, 65_536) };
    case 'select':
      keys(input, ['op', 'value'], path);
      return { op: 'select', value: stringValue(input.value, `${path}.value`, 4096) };
    case 'setToggleState':
      keys(input, ['op', 'state'], path);
      return { op: 'setToggleState', state: oneOf(input.state, `${path}.state`, ['off', 'on']) };
    default:
      throw new ControlContractError(`${path}.op is unsupported`);
  }
}

function parsePredicate(value: unknown, path: string): ControlPredicate {
  const input = record(value, path);
  const kind = oneOf(input.kind, `${path}.kind`, [
    'enabled',
    'valueEquals',
    'textPresent',
    'toggleStateEquals',
    'elementAbsent',
    'urlEquals',
  ] as const);
  switch (kind) {
    case 'enabled':
      keys(input, ['kind', 'equals'], path);
      return { kind, equals: boolean(input.equals, `${path}.equals`) };
    case 'valueEquals':
      keys(input, ['kind', 'value'], path);
      return { kind, value: stringValue(input.value, `${path}.value`, 65_536) };
    case 'textPresent':
      keys(input, ['kind', 'scope', 'text'], path);
      return {
        kind,
        scope: oneOf(input.scope, `${path}.scope`, ['surface', 'subtree']),
        text: text(input.text, `${path}.text`),
      };
    case 'toggleStateEquals':
      keys(input, ['kind', 'state'], path);
      return {
        kind,
        state: oneOf(input.state, `${path}.state`, ['off', 'on', 'indeterminate']),
      };
    case 'elementAbsent':
      keys(input, ['kind', 'scope', 'role', 'name'], path);
      return {
        kind,
        scope: oneOf(input.scope, `${path}.scope`, ['surface', 'subtree']),
        ...(input.role === undefined ? {} : { role: text(input.role, `${path}.role`) }),
        ...(input.name === undefined ? {} : { name: text(input.name, `${path}.name`) }),
      };
    case 'urlEquals':
      keys(input, ['kind', 'url'], path);
      return { kind, url: text(input.url, `${path}.url`, 8192) };
  }
}

function parseTarget(value: unknown, path: string): ControlTarget {
  const input = record(value, path);
  keys(input, ['ref', 'locator'], path);
  const hasRef = input.ref !== undefined;
  const hasLocator = input.locator !== undefined;
  if (hasRef === hasLocator) {
    throw new ControlContractError(`${path} must contain exactly one of ref or locator`);
  }
  if (hasRef) {
    return { ref: text(input.ref, `${path}.ref`, 512) };
  }
  const locator = record(input.locator, `${path}.locator`);
  keys(
    locator,
    ['scope', 'role', 'name', 'match', 'requireUnique', 'observedAncestor'],
    `${path}.locator`,
  );
  if (locator.requireUnique !== true) {
    throw new ControlContractError(`${path}.locator.requireUnique must be true`);
  }
  return {
    locator: {
      scope: oneOf(locator.scope, `${path}.locator.scope`, ['surface', 'subtree']),
      role: text(locator.role, `${path}.locator.role`),
      name: text(locator.name, `${path}.locator.name`),
      match: oneOf(locator.match, `${path}.locator.match`, ['exact']),
      requireUnique: true,
      ...(locator.observedAncestor === undefined
        ? {}
        : { observedAncestor: text(locator.observedAncestor, `${path}.locator.observedAncestor`) }),
    },
  };
}

function parseStep(value: unknown, path: string): ControlStep {
  const input = record(value, path);
  keys(
    input,
    [
      'id',
      'surfaceId',
      'dependsOn',
      'target',
      'action',
      'preconditions',
      'postcondition',
      'timeoutMs',
    ],
    path,
  );
  if (!Array.isArray(input.dependsOn))
    throw new ControlContractError(`${path}.dependsOn must be an array`);
  if (!Array.isArray(input.preconditions))
    throw new ControlContractError(`${path}.preconditions must be an array`);
  return {
    id: text(input.id, `${path}.id`, 128),
    surfaceId: text(input.surfaceId, `${path}.surfaceId`, 256),
    dependsOn: input.dependsOn.map((dependency, index) =>
      text(dependency, `${path}.dependsOn.${index}`, 128),
    ),
    target: parseTarget(input.target, `${path}.target`),
    action: parseAction(input.action, `${path}.action`),
    preconditions: input.preconditions.map((predicate, index) =>
      parsePredicate(predicate, `${path}.preconditions.${index}`),
    ),
    postcondition: parsePredicate(input.postcondition, `${path}.postcondition`),
    timeoutMs: integer(input.timeoutMs, `${path}.timeoutMs`, 1, CONTROL_MAX_DEADLINE_MS),
  };
}

function ensureAcyclic(steps: ControlStep[]): void {
  const ids = new Set(steps.map((step) => step.id));
  const state = new Map<string, 'visiting' | 'visited'>();
  const visit = (id: string): void => {
    if (state.get(id) === 'visiting')
      throw new ControlContractError('steps contain a dependency cycle');
    if (state.get(id) === 'visited') return;
    const step = steps.find((candidate) => candidate.id === id);
    if (!step) throw new ControlContractError(`unknown dependency ${id}`);
    state.set(id, 'visiting');
    for (const dependency of step.dependsOn) {
      if (dependency === id || !ids.has(dependency)) {
        throw new ControlContractError(`step ${id} depends on unknown step ${dependency}`);
      }
      visit(dependency);
    }
    state.set(id, 'visited');
  };
  for (const step of steps) visit(step.id);
}

/** Parse and close the model-facing plan shape before any adapter is called. */
export function parseControlPlan(value: unknown): ControlPlan {
  const input = record(value, 'plan');
  keys(
    input,
    [
      'schemaVersion',
      'requestId',
      'surfaceIds',
      'expectedObservations',
      'mode',
      'deadlineMs',
      'maxConcurrency',
      'steps',
      'output',
    ],
    'plan',
  );
  if (input.schemaVersion !== CONTROL_SCHEMA_VERSION) {
    throw new ControlContractError(`schemaVersion must be ${CONTROL_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(input.surfaceIds) || input.surfaceIds.length === 0) {
    throw new ControlContractError('surfaceIds must contain at least one surface');
  }
  if (input.surfaceIds.length > CONTROL_MAX_SURFACES) {
    throw new ControlContractError(
      `surfaceIds may contain at most ${CONTROL_MAX_SURFACES} surfaces`,
    );
  }
  const surfaceIds = input.surfaceIds.map((surfaceId, index) =>
    text(surfaceId, `surfaceIds.${index}`, 256),
  );
  if (new Set(surfaceIds).size !== surfaceIds.length) {
    throw new ControlContractError('surfaceIds must be unique');
  }
  const observations = record(input.expectedObservations, 'expectedObservations');
  keys(observations, surfaceIds, 'expectedObservations');
  const expectedObservations: Record<string, string> = {};
  for (const surfaceId of surfaceIds) {
    expectedObservations[surfaceId] = text(
      observations[surfaceId],
      `expectedObservations.${surfaceId}`,
      256,
    );
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new ControlContractError('steps must contain at least one step');
  }
  if (input.steps.length > CONTROL_MAX_STEPS) {
    throw new ControlContractError(`steps may contain at most ${CONTROL_MAX_STEPS} steps`);
  }
  const steps = input.steps.map((step, index) => parseStep(step, `steps.${index}`));
  if (new Set(steps.map((step) => step.id)).size !== steps.length) {
    throw new ControlContractError('step ids must be unique');
  }
  for (const step of steps) {
    if (!surfaceIds.includes(step.surfaceId)) {
      throw new ControlContractError(`step ${step.id} references an undeclared surface`);
    }
  }
  ensureAcyclic(steps);

  const output = record(input.output, 'output');
  keys(output, ['kind', 'baseObservationId', 'maxOutputTokens'], 'output');
  const outputKind = oneOf(output.kind, 'output.kind', ['delta', 'full']);
  if (outputKind === 'delta' && output.baseObservationId === undefined) {
    throw new ControlContractError('output.baseObservationId is required for delta output');
  }
  return {
    schemaVersion: CONTROL_SCHEMA_VERSION,
    requestId: text(input.requestId, 'requestId', 256),
    surfaceIds,
    expectedObservations,
    mode: oneOf(input.mode, 'mode', ['sharedSemantic', 'isolated']),
    deadlineMs: integer(input.deadlineMs, 'deadlineMs', 1, CONTROL_MAX_DEADLINE_MS),
    maxConcurrency: integer(input.maxConcurrency, 'maxConcurrency', 1, CONTROL_MAX_CONCURRENCY),
    steps,
    output: {
      kind: outputKind,
      ...(output.baseObservationId === undefined
        ? {}
        : { baseObservationId: text(output.baseObservationId, 'output.baseObservationId', 256) }),
      maxOutputTokens: integer(output.maxOutputTokens, 'output.maxOutputTokens', 1, 4000),
    },
  };
}
