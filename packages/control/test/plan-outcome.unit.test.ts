import assert from 'node:assert/strict';
import test from 'node:test';
import type { ControlObservation, ControlPlan } from '../../protocol/src/control.js';
import { ControlAdapterError, type ControlAdapter } from '../src/adapter.js';
import {
  asControlError,
  failedPlanOutcome,
  failedStepStatus,
  nodeBudget,
  preflightFailure,
} from '../src/plan-outcome.js';

test('asControlError keeps adapter error details and the step id', () => {
  const error = new ControlAdapterError('CONTROL_X', 'boom', 'dispatched', 'inspectOutcome');
  assert.deepEqual(asControlError(error, 'step-1'), {
    code: 'CONTROL_X',
    stepId: 'step-1',
    dispatchState: 'dispatched',
    recovery: 'inspectOutcome',
    message: 'CONTROL_X: boom',
  });
  assert.equal(asControlError(error).stepId, undefined);
});

test('asControlError normalizes foreign errors and plain values', () => {
  const foreign = Object.assign(new Error('disk full'), {
    code: 'EIO',
    dispatchState: 'unknown' as const,
  });
  assert.deepEqual(asControlError(foreign, 's'), {
    code: 'EIO',
    stepId: 's',
    dispatchState: 'unknown',
    recovery: 'none',
    message: 'disk full',
  });
  assert.deepEqual(asControlError('nope'), {
    code: 'CONTROL_EXECUTION_FAILED',
    dispatchState: 'notDispatched',
    recovery: 'none',
    message: 'nope',
  });
  assert.equal(asControlError(undefined).message, 'undefined');
});

test('nodeBudget scales with output tokens within fixed bounds', () => {
  assert.equal(nodeBudget(0), 1);
  assert.equal(nodeBudget(1_200), 100);
  assert.equal(nodeBudget(1_000_000), 500);
});

test('failedStepStatus maps recovery and dispatch state', () => {
  const error = (recovery: any, dispatchState: any = 'notDispatched') =>
    asControlError(new ControlAdapterError('C', 'm', dispatchState, recovery));
  assert.equal(failedStepStatus(error('needsApproval')), 'awaitingApproval');
  assert.equal(failedStepStatus(error('needsContext')), 'needsContext');
  assert.equal(failedStepStatus(error('refresh')), 'needsContext');
  assert.equal(failedStepStatus(error('none', 'unknown')), 'unknown');
  assert.equal(failedStepStatus(error('inspectOutcome', 'dispatched')), 'failed');
});

test('failedPlanOutcome picks status and checkpoint from the failed step', () => {
  const step = (status: any) => ({ id: 'a', status, postcondition: 'notChecked' as const });
  assert.deepEqual(
    failedPlanOutcome(step('awaitingApproval'), 1).checkpoint?.reason,
    'needsApproval',
  );
  assert.equal(failedPlanOutcome(step('awaitingApproval'), 1).status, 'awaitingApproval');
  assert.deepEqual(failedPlanOutcome(step('needsContext'), 3), {
    status: 'needsContext',
    checkpoint: {
      reason: 'needsContext',
      nextAction: 'Refresh the affected surface before continuing.',
    },
  });
  assert.deepEqual(failedPlanOutcome(step('failed'), 2), { status: 'partial' });
  assert.deepEqual(failedPlanOutcome(undefined, 1), { status: 'failed' });
});

function observation(id: string): ControlObservation {
  const now = '2026-09-23T00:00:00.000Z';
  return {
    observationId: id,
    surfaceId: 's1',
    generation: 1,
    revision: 1,
    freshness: 'fresh',
    watchHealth: 'healthy',
    observedAt: now,
    lastValidatedAt: now,
    policyRevision: 1,
    mode: 'sharedSemantic',
    coverage: { scope: 'surface', truncated: false, omittedNodes: 0 },
    nodes: [],
  };
}

function plan(mode: ControlPlan['mode'] = 'sharedSemantic'): ControlPlan {
  return {
    schemaVersion: 1,
    requestId: 'r',
    surfaceIds: ['s1'],
    expectedObservations: { s1: 'obs_1' },
    mode,
    deadlineMs: 1000,
    maxConcurrency: 1,
    steps: [],
    output: { kind: 'full', maxOutputTokens: 100 },
  };
}

function adapter(mode: ControlPlan['mode']): ControlAdapter {
  return { surfaceId: 's1', mode } as unknown as ControlAdapter;
}

test('preflightFailure explains each reason a plan cannot start', () => {
  const current = () => observation('obs_1');
  assert.equal(
    preflightFailure(plan(), new Map(), current)?.error?.code,
    'CONTROL_SURFACE_NOT_FOUND',
  );

  const shared = new Map([['s1', adapter('sharedSemantic')]]);
  const isolated = new Map([['s1', adapter('isolated')]]);
  const toIsolated = preflightFailure(plan('isolated'), shared, current);
  assert.equal(toIsolated?.error?.code, 'CONTROL_MODE_MISMATCH');
  assert.equal(toIsolated?.checkpoint?.reason, 'chooseIsolatedRunner');
  const toShared = preflightFailure(plan(), isolated, current);
  assert.equal(toShared?.error?.recovery, 'needsContext');
  assert.match(toShared?.checkpoint?.nextAction ?? '', /shared semantic mode/);

  const missing = preflightFailure(plan(), shared, () => undefined);
  assert.equal(missing?.error?.code, 'CONTROL_OBSERVATION_STALE');
  assert.equal(missing?.error?.observationId, undefined);
  const stale = preflightFailure(plan(), shared, () => observation('obs_2'));
  assert.equal(stale?.error?.observationId, 'obs_2');

  assert.equal(preflightFailure(plan(), shared, current), undefined);
});
