import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_WAIT_FOR_MS } from '../../browser/src/driver.js';
import { browserOperation } from '../src/browser-operations.js';
import {
  isFirstVisit,
  noteVisited,
  resetVisited,
  trackedSessionCount,
} from '../src/browser-risk.js';

test('a domain already visited in this session is no longer a first visit', () => {
  const session = 'ledger-session-basic';
  assert.equal(isFirstVisit(session, 'https://a.example.com/one'), true);
  noteVisited(session, 'https://a.example.com/one');
  assert.equal(isFirstVisit(session, 'https://b.example.com/two'), false);
  resetVisited(session);
});

test('disconnecting a session drops its ledger entry', () => {
  const session = 'ledger-session-reset';
  noteVisited(session, 'https://example.org/');
  assert.equal(isFirstVisit(session, 'https://example.org/'), false);
  resetVisited(session);
  assert.equal(isFirstVisit(session, 'https://example.org/'), true);
});

test('the ledger is capped, so a long-lived process cannot grow it without bound', () => {
  const before = trackedSessionCount();
  for (let index = 0; index < 600; index += 1) {
    noteVisited(`ledger-flood-${index}`, 'https://example.net/');
  }
  const after = trackedSessionCount();
  assert.ok(after <= 256, `ledger held ${after} sessions`);
  assert.ok(after >= 1, 'the cap must not empty the ledger outright');
  assert.ok(after <= before + 600);
  // Losing the least recently used entry costs one extra MEDIUM tier on a
  // re-navigation, which is the safe direction to fail.
  assert.equal(isFirstVisit('ledger-flood-599', 'https://example.net/'), false);
});

test('a wait_for above the ceiling is refused rather than silently truncated', () => {
  assert.throws(
    () =>
      browserOperation('browser_act_many', {
        actions: [{ op: 'wait_for', text: 'done', timeoutMs: MAX_WAIT_FOR_MS + 1 }],
      }),
    (error: any) =>
      error.code === 'INVALID_REQUEST' && /must not exceed/.test(String(error.message)),
  );
});

test('a wait_for at the ceiling is accepted', () => {
  const operation = browserOperation('browser_act_many', {
    actions: [{ op: 'wait_for', text: 'done', timeoutMs: MAX_WAIT_FOR_MS }],
  });
  assert.equal(operation.kind, 'browser.act');
});
