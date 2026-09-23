import assert from 'node:assert/strict';
import test from 'node:test';
import { parseControlPlan } from '../src/control-parse.js';

type Json = Record<string, any>;

function plan(overrides: Json = {}): Json {
  return {
    schemaVersion: 1,
    requestId: 'req_1',
    surfaceIds: ['s1'],
    expectedObservations: { s1: 'obs_1' },
    mode: 'sharedSemantic',
    deadlineMs: 10_000,
    maxConcurrency: 1,
    steps: [step()],
    output: { kind: 'full', maxOutputTokens: 500 },
    ...overrides,
  };
}

function step(overrides: Json = {}): Json {
  return {
    id: 'a',
    surfaceId: 's1',
    dependsOn: [],
    target: { ref: 'ref_1' },
    action: { op: 'click' },
    preconditions: [],
    postcondition: { kind: 'enabled', equals: true },
    timeoutMs: 1_000,
    ...overrides,
  };
}

function withStep(overrides: Json): Json {
  return plan({ steps: [step(overrides)] });
}

test('accepts every supported action shape', () => {
  const actions: Json[] = [
    { op: 'click' },
    { op: 'type', text: 'hello' },
    { op: 'type', text: 'hello', clear: false },
    { op: 'press_key', key: 'Enter' },
    { op: 'scroll', dx: 0, dy: -120 },
    { op: 'wait_for', timeoutMs: 500 },
    { op: 'wait_for', text: 'Ready', timeoutMs: 500 },
    { op: 'invoke' },
    { op: 'setValue', value: '42' },
    { op: 'select', value: 'Blue' },
    { op: 'setToggleState', state: 'on' },
  ];
  for (const action of actions) {
    assert.deepEqual(parseControlPlan(withStep({ action })).steps[0]!.action, action);
  }
});

test('accepts every supported predicate shape', () => {
  const predicates: Json[] = [
    { kind: 'enabled', equals: false },
    { kind: 'valueEquals', value: 'x' },
    { kind: 'textPresent', scope: 'subtree', text: 'Saved' },
    { kind: 'toggleStateEquals', state: 'indeterminate' },
    { kind: 'elementAbsent', scope: 'surface' },
    { kind: 'elementAbsent', scope: 'surface', role: 'dialog', name: 'Error' },
    { kind: 'urlEquals', url: 'https://example.test/done' },
  ];
  for (const predicate of predicates) {
    const parsed = parseControlPlan(
      withStep({ preconditions: [predicate], postcondition: predicate }),
    );
    assert.deepEqual(parsed.steps[0]!.preconditions[0], predicate);
    assert.deepEqual(parsed.steps[0]!.postcondition, predicate);
  }
});

test('accepts locators with an observed ancestor and delta output', () => {
  const parsed = parseControlPlan(
    plan({
      steps: [
        step({
          target: {
            locator: {
              scope: 'subtree',
              role: 'button',
              name: 'Save',
              match: 'exact',
              requireUnique: true,
              observedAncestor: 'ref_form',
            },
          },
        }),
      ],
      output: { kind: 'delta', baseObservationId: 'obs_1', maxOutputTokens: 100 },
    }),
  );
  const target = parsed.steps[0]!.target;
  assert.ok('locator' in target);
  assert.equal(target.locator.observedAncestor, 'ref_form');
  assert.equal(parsed.output.baseObservationId, 'obs_1');
});

const rejectedActions: Array<[Json | unknown, RegExp]> = [
  ['click', /steps\.0\.action must be an object/],
  [[], /steps\.0\.action must be an object/],
  [{}, /steps\.0\.action\.op is required/],
  [{ op: 'drag' }, /steps\.0\.action\.op is unsupported/],
  [{ op: 'type', text: 7 }, /steps\.0\.action\.text must be a string/],
  [{ op: 'type', text: 'x', clear: 'yes' }, /steps\.0\.action\.clear must be a boolean/],
  [{ op: 'press_key', key: '' }, /steps\.0\.action\.key must be a non-empty string/],
  [{ op: 'scroll', dx: 'left', dy: 0 }, /dx and steps\.0\.action\.dy must be finite numbers/],
  [{ op: 'scroll', dx: 0, dy: Infinity }, /must be finite numbers/],
  [{ op: 'scroll', dx: Number.NaN, dy: 0 }, /must be finite numbers/],
  [{ op: 'scroll', dx: 0 }, /must be finite numbers/],
  [{ op: 'wait_for', timeoutMs: 0 }, /steps\.0\.action\.timeoutMs must be between/],
  [{ op: 'wait_for', text: '', timeoutMs: 5 }, /steps\.0\.action\.text must be a non-empty/],
  [{ op: 'invoke', target: 'x' }, /Unknown key at steps\.0\.action\.target/],
  [{ op: 'setValue', value: null }, /steps\.0\.action\.value must be a string/],
  [{ op: 'select', value: 'x'.repeat(4097) }, /steps\.0\.action\.value must be a string/],
  [{ op: 'setToggleState', state: 'indeterminate' }, /steps\.0\.action\.state has an unsupported/],
];

test('rejects malformed actions with the failing path', () => {
  for (const [action, message] of rejectedActions) {
    assert.throws(() => parseControlPlan(withStep({ action })), message, JSON.stringify(action));
  }
});

const rejectedPredicates: Array<[unknown, RegExp]> = [
  [null, /steps\.0\.postcondition must be an object/],
  [{ kind: 'enabled', equals: 'true' }, /postcondition\.equals must be a boolean/],
  [{ kind: 'enabled', equals: true, extra: 1 }, /Unknown key at steps\.0\.postcondition\.extra/],
  [{ kind: 'valueEquals', value: 1 }, /postcondition\.value must be a string/],
  [{ kind: 'textPresent', scope: 'page', text: 'x' }, /postcondition\.scope has an unsupported/],
  [{ kind: 'textPresent', scope: 'surface', text: '' }, /postcondition\.text must be a non-empty/],
  [{ kind: 'toggleStateEquals', state: 'maybe' }, /postcondition\.state has an unsupported/],
  [
    { kind: 'elementAbsent', scope: 'surface', role: '' },
    /postcondition\.role must be a non-empty/,
  ],
  [
    { kind: 'elementAbsent', scope: 'surface', name: '' },
    /postcondition\.name must be a non-empty/,
  ],
  [{ kind: 'urlEquals', url: '' }, /postcondition\.url must be a non-empty/],
];

test('rejects malformed predicates with the failing path', () => {
  for (const [postcondition, message] of rejectedPredicates) {
    assert.throws(
      () => parseControlPlan(withStep({ postcondition })),
      message,
      JSON.stringify(postcondition),
    );
  }
});

const locator = {
  scope: 'surface',
  role: 'button',
  name: 'Save',
  match: 'exact',
  requireUnique: true,
};

const rejectedTargets: Array<[unknown, RegExp]> = [
  [{}, /exactly one of ref or locator/],
  [{ ref: '' }, /steps\.0\.target\.ref must be a non-empty/],
  [{ locator: 'Save' }, /steps\.0\.target\.locator must be an object/],
  [{ locator: { ...locator, requireUnique: false } }, /locator\.requireUnique must be true/],
  [{ locator: { ...locator, scope: 'page' } }, /locator\.scope has an unsupported/],
  [{ locator: { ...locator, role: '' } }, /locator\.role must be a non-empty/],
  [{ locator: { ...locator, name: '' } }, /locator\.name must be a non-empty/],
  [{ locator: { ...locator, match: 'fuzzy' } }, /locator\.match has an unsupported/],
  [{ locator: { ...locator, observedAncestor: '' } }, /locator\.observedAncestor must be/],
  [{ locator: { ...locator, xpath: '//a' } }, /Unknown key at steps\.0\.target\.locator\.xpath/],
];

test('rejects malformed targets with the failing path', () => {
  for (const [target, message] of rejectedTargets) {
    assert.throws(() => parseControlPlan(withStep({ target })), message, JSON.stringify(target));
  }
});

test('rejects malformed steps', () => {
  assert.throws(() => parseControlPlan(plan({ steps: ['a'] })), /steps\.0 must be an object/);
  assert.throws(
    () => parseControlPlan(withStep({ dependsOn: 'a' })),
    /steps\.0\.dependsOn must be an array/,
  );
  assert.throws(
    () => parseControlPlan(withStep({ preconditions: {} })),
    /steps\.0\.preconditions must be an array/,
  );
  assert.throws(() => parseControlPlan(withStep({ id: '' })), /steps\.0\.id must be a non-empty/);
  assert.throws(
    () => parseControlPlan(withStep({ dependsOn: [5] })),
    /steps\.0\.dependsOn\.0 must be a non-empty/,
  );
  assert.throws(
    () => parseControlPlan(withStep({ timeoutMs: 1.5 })),
    /steps\.0\.timeoutMs must be between/,
  );
  assert.throws(
    () => parseControlPlan(withStep({ dependsOn: ['a'] })),
    /step a depends on unknown step a/,
  );
  assert.throws(
    () => parseControlPlan(withStep({ dependsOn: ['missing'] })),
    /step a depends on unknown step missing/,
  );
  assert.throws(
    () => parseControlPlan(plan({ steps: [step(), step()] })),
    /step ids must be unique/,
  );
  assert.throws(
    () => parseControlPlan(withStep({ surfaceId: 's2' })),
    /step a references an undeclared surface/,
  );
});

test('accepts a dependency chain that shares an ancestor', () => {
  const parsed = parseControlPlan(
    plan({
      steps: [
        step({ id: 'a' }),
        step({ id: 'b', dependsOn: ['a'] }),
        step({ id: 'c', dependsOn: ['a', 'b'] }),
      ],
    }),
  );
  assert.deepEqual(
    parsed.steps.map((candidate) => candidate.dependsOn),
    [[], ['a'], ['a', 'b']],
  );
});

test('rejects malformed plan envelopes', () => {
  const cases: Array<[unknown, RegExp]> = [
    [null, /plan must be an object/],
    [plan({ schemaVersion: 2 }), /schemaVersion must be 1/],
    [plan({ surfaceIds: [] }), /surfaceIds must contain at least one surface/],
    [plan({ surfaceIds: 's1' }), /surfaceIds must contain at least one surface/],
    [plan({ surfaceIds: [''] }), /surfaceIds\.0 must be a non-empty/],
    [plan({ surfaceIds: ['s1', 's1'] }), /surfaceIds must be unique/],
    [plan({ expectedObservations: null }), /expectedObservations must be an object/],
    [
      plan({ expectedObservations: { s1: 'obs', s9: 'obs' } }),
      /Unknown key at expectedObservations\.s9/,
    ],
    [plan({ expectedObservations: {} }), /expectedObservations\.s1 must be a non-empty/],
    [plan({ steps: [] }), /steps must contain at least one step/],
    [plan({ steps: {} }), /steps must contain at least one step/],
    [plan({ output: 'full' }), /output must be an object/],
    [
      plan({ output: { kind: 'full', maxOutputTokens: 1, extra: true } }),
      /Unknown key at output\.extra/,
    ],
    [plan({ output: { kind: 'patch', maxOutputTokens: 1 } }), /output\.kind has an unsupported/],
    [plan({ output: { kind: 'delta', maxOutputTokens: 1 } }), /baseObservationId is required/],
    [
      plan({ output: { kind: 'delta', baseObservationId: '', maxOutputTokens: 1 } }),
      /output\.baseObservationId must be a non-empty/,
    ],
    [plan({ output: { kind: 'full', maxOutputTokens: 4001 } }), /output\.maxOutputTokens must be/],
    [plan({ requestId: '' }), /requestId must be a non-empty/],
    [plan({ mode: 'remote' }), /mode has an unsupported/],
    [plan({ maxConcurrency: 5 }), /maxConcurrency must be between 1 and 4/],
  ];
  for (const [input, message] of cases) {
    assert.throws(() => parseControlPlan(input), message, String(message));
  }
});
