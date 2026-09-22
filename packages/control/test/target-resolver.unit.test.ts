import assert from 'node:assert/strict';
import test from 'node:test';
import type { ControlObservation } from '../../protocol/src/control.js';
import {
  evaluateControlPredicate,
  resolveControlTarget,
  supportsControlAction,
} from '../src/target-resolver.js';

function observation(): ControlObservation {
  const now = '2026-09-22T00:00:00.000Z';
  return {
    observationId: 'obs_1',
    surfaceId: 'desktop:w1',
    generation: 1,
    revision: 1,
    freshness: 'fresh',
    watchHealth: 'healthy',
    observedAt: now,
    lastValidatedAt: now,
    policyRevision: 1,
    mode: 'sharedSemantic',
    coverage: { scope: 'surface', truncated: false, omittedNodes: 0 },
    nodes: [
      {
        ref: 'group_a',
        role: 'group',
        name: 'Primary',
        enabled: true,
        actions: [],
        children: [
          {
            ref: 'save_a',
            role: 'button',
            name: 'Save',
            enabled: true,
            actions: ['invoke'],
            parentRef: 'group_a',
          },
        ],
      },
      {
        ref: 'group_b',
        role: 'group',
        name: 'Secondary',
        enabled: true,
        actions: [],
        children: [
          {
            ref: 'save_b',
            role: 'button',
            name: 'Save',
            enabled: true,
            actions: ['invoke'],
            parentRef: 'group_b',
          },
        ],
      },
    ],
  };
}

test('exact locators reject duplicate names instead of guessing', () => {
  assert.throws(
    () =>
      resolveControlTarget(observation(), {
        locator: {
          scope: 'surface',
          role: 'button',
          name: 'Save',
          match: 'exact',
          requireUnique: true,
        },
      }),
    /CONTROL_TARGET_AMBIGUOUS/,
  );
});

test('observed ancestor disambiguates an exact locator', () => {
  const node = resolveControlTarget(observation(), {
    locator: {
      scope: 'subtree',
      role: 'button',
      name: 'Save',
      match: 'exact',
      requireUnique: true,
      observedAncestor: 'group_a',
    },
  });
  assert.equal(node.ref, 'save_a');
  assert.equal(supportsControlAction(node, { op: 'invoke' }), true);
  assert.equal(supportsControlAction(node, { op: 'click' }), true);
});

test('predicates use current semantic state', () => {
  const current = observation();
  const node = resolveControlTarget(current, { ref: 'save_a' });
  assert.equal(evaluateControlPredicate(current, { kind: 'enabled', equals: true }, node), true);
  assert.equal(
    evaluateControlPredicate(
      current,
      { kind: 'textPresent', scope: 'surface', text: 'Secondary' },
      node,
    ),
    true,
  );
  assert.equal(
    evaluateControlPredicate(
      current,
      { kind: 'elementAbsent', scope: 'surface', role: 'dialog', name: 'Confirm' },
      node,
    ),
    true,
  );
});
