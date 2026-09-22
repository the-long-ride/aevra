import assert from 'node:assert/strict';
import test from 'node:test';
import { parseControlPlan } from '../src/control.js';

function validPlan(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    requestId: 'req_settings_001',
    surfaceIds: ['surface_settings'],
    expectedObservations: { surface_settings: 'obs_17' },
    mode: 'sharedSemantic',
    deadlineMs: 15_000,
    maxConcurrency: 1,
    steps: [
      {
        id: 'name',
        surfaceId: 'surface_settings',
        dependsOn: [],
        target: { ref: 'ref_name' },
        action: { op: 'type', text: 'Team workspace', clear: true },
        preconditions: [{ kind: 'enabled', equals: true }],
        postcondition: { kind: 'valueEquals', value: 'Team workspace' },
        timeoutMs: 3_000,
      },
      {
        id: 'save',
        surfaceId: 'surface_settings',
        dependsOn: ['name'],
        target: {
          locator: {
            scope: 'surface',
            role: 'button',
            name: 'Save',
            match: 'exact',
            requireUnique: true,
          },
        },
        action: { op: 'click' },
        preconditions: [{ kind: 'enabled', equals: true }],
        postcondition: { kind: 'textPresent', scope: 'surface', text: 'Saved' },
        timeoutMs: 5_000,
      },
    ],
    output: { kind: 'delta', baseObservationId: 'obs_17', maxOutputTokens: 1_000 },
  };
}

test('accepts the bounded typed control plan contract', () => {
  const plan = parseControlPlan(validPlan());

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.steps[1]?.target.locator?.requireUnique, true);
  assert.deepEqual(plan.steps[0]?.dependsOn, []);
});

test('accepts empty values for clearing controls and verifying cleared state', () => {
  const input = validPlan();
  (input.steps as Array<Record<string, unknown>>)[0]!.action = {
    op: 'type',
    text: '',
    clear: true,
  };
  (input.steps as Array<Record<string, unknown>>)[0]!.postcondition = {
    kind: 'valueEquals',
    value: '',
  };

  const plan = parseControlPlan(input);

  assert.deepEqual(plan.steps[0]?.action, { op: 'type', text: '', clear: true });
  assert.deepEqual(plan.steps[0]?.postcondition, { kind: 'valueEquals', value: '' });
});

test('rejects unknown action keys before a plan can be dispatched', () => {
  const input = validPlan();
  (input.steps as Array<Record<string, unknown>>)[0]!.action = {
    op: 'click',
    script: 'document.body.click()',
  };

  assert.throws(() => parseControlPlan(input), /Unknown key at steps\.0\.action\.script/);
});

test('rejects model-supplied ownership and ambiguous targets', () => {
  const owned = { ...validPlan(), ownerId: 'session-from-model' };
  assert.throws(() => parseControlPlan(owned), /Unknown key at plan\.ownerId/);

  const ambiguous = validPlan();
  (ambiguous.steps as Array<Record<string, unknown>>)[0]!.target = {
    ref: 'ref_name',
    locator: {
      scope: 'surface',
      role: 'textbox',
      name: 'Display name',
      match: 'exact',
      requireUnique: true,
    },
  };
  assert.throws(() => parseControlPlan(ambiguous), /exactly one of ref or locator/);
});

test('rejects cyclic and oversized plans before mutation', () => {
  const cyclic = validPlan();
  const steps = cyclic.steps as Array<Record<string, unknown>>;
  steps[0]!.dependsOn = ['save'];
  assert.throws(() => parseControlPlan(cyclic), /dependency cycle/);

  const oversized = validPlan();
  oversized.steps = Array.from({ length: 33 }, (_, index) => ({
    ...steps[0],
    id: `step-${index}`,
    dependsOn: [],
  }));
  assert.throws(() => parseControlPlan(oversized), /at most 32 steps/);
});

test('rejects invalid execution bounds and unsupported predicate shapes', () => {
  const overDeadline = { ...validPlan(), deadlineMs: 60_001 };
  assert.throws(() => parseControlPlan(overDeadline), /deadlineMs must be between 1 and 60000/);

  const invalidPredicate = validPlan();
  (invalidPredicate.steps as Array<Record<string, unknown>>)[0]!.postcondition = {
    kind: 'javascript',
    expression: 'true',
  };
  assert.throws(
    () => parseControlPlan(invalidPredicate),
    /steps\.0\.postcondition\.kind has an unsupported value/,
  );
});

test('rejects plans that exceed the bounded surface declaration', () => {
  const input = validPlan();
  input.surfaceIds = Array.from({ length: 9 }, (_, index) => `surface-${index}`);
  input.expectedObservations = Object.fromEntries(
    (input.surfaceIds as string[]).map((surfaceId) => [surfaceId, `obs-${surfaceId}`]),
  );
  (input.steps as Array<Record<string, unknown>>).forEach((step) => {
    step.surfaceId = 'surface-0';
  });

  assert.throws(() => parseControlPlan(input), /at most 8 surfaces/);
});
