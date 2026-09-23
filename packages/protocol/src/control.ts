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
