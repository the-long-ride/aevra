import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRefreshDashboard } from '../../apps/web/pages/dashboard-refresh.js';

function containerContaining(...nodes) {
  return { contains(node) { return nodes.includes(node); } };
}

test('background Dashboard polling does not replace focused form controls', () => {
  const input = { tagName: 'INPUT' };
  const textarea = { tagName: 'TEXTAREA' };
  const container = containerContaining(input, textarea);

  assert.equal(shouldRefreshDashboard(container, input, false), false);
  assert.equal(shouldRefreshDashboard(container, textarea, false), false);
});

test('background Dashboard polling may refresh when focus is outside the Dashboard', () => {
  const outside = { tagName: 'INPUT' };
  const container = containerContaining();
  assert.equal(shouldRefreshDashboard(container, outside, false), true);
});

test('explicit Dashboard mutations may force a refresh while a form control is focused', () => {
  const input = { tagName: 'INPUT' };
  const container = containerContaining(input);
  assert.equal(shouldRefreshDashboard(container, input, true), true);
});
