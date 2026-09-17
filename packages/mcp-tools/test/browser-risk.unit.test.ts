import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserOperationRisk,
  isFirstVisit,
  noteVisited,
  refuseBlockedOrigin,
  refuseSensitiveScreenshot,
  resetVisited,
} from '../src/browser-risk.js';

test.beforeEach(() => resetVisited('visit-session'));

test('a domain is first-visit until it is noted, then it is not', () => {
  assert.equal(isFirstVisit('visit-session', 'https://example.com/a'), true);
  noteVisited('visit-session', 'https://example.com/a');
  assert.equal(isFirstVisit('visit-session', 'https://example.com/a'), false);
});

test('visits are tracked per registrable domain, not per URL', () => {
  noteVisited('visit-session', 'https://a.example.com/one');
  assert.equal(isFirstVisit('visit-session', 'https://b.example.com/two'), false);
  assert.equal(isFirstVisit('visit-session', 'https://other.test/'), true);
});

test('visits are tracked per session', () => {
  noteVisited('visit-session', 'https://example.com/');
  assert.equal(isFirstVisit('another-session', 'https://example.com/'), true);
});

test('resetVisited clears the session', () => {
  noteVisited('visit-session', 'https://example.com/');
  resetVisited('visit-session');
  assert.equal(isFirstVisit('visit-session', 'https://example.com/'), true);
});

test('an unparseable url is treated as a first visit and never noted', () => {
  assert.equal(isFirstVisit('visit-session', 'not a url'), true);
  noteVisited('visit-session', 'not a url');
  assert.equal(isFirstVisit('visit-session', 'not a url'), true);
});

test('a navigation is MEDIUM on a first visit and LOW on a return', () => {
  assert.equal(
    browserOperationRisk({
      tool: 'browser_navigate',
      originClass: 'NORMAL',
      navigates: true,
      firstVisit: true,
    }),
    'MEDIUM',
  );
  assert.equal(
    browserOperationRisk({
      tool: 'browser_navigate',
      originClass: 'NORMAL',
      navigates: true,
      firstVisit: false,
    }),
    'LOW',
  );
});

test('opening a tab is tiered as a navigation, not as a read', () => {
  // The signal is behavioural: browser_tabs sends the browser to a URL when the
  // action is open, and must not be tiered by its name.
  assert.equal(
    browserOperationRisk({
      tool: 'browser_tabs',
      originClass: 'NORMAL',
      navigates: true,
      firstVisit: true,
    }),
    'MEDIUM',
  );
  assert.equal(
    browserOperationRisk({ tool: 'browser_tabs', originClass: 'NORMAL' }),
    'LOW',
    'listing tabs stays read-only',
  );
});

test('a blocked origin refuses and a normal one does not', () => {
  assert.throws(() => refuseBlockedOrigin('chrome://settings'), /privileged surface/);
  assert.doesNotThrow(() => refuseBlockedOrigin('https://example.com/'));
});

test('only a vision snapshot of a sensitive origin is refused', () => {
  assert.throws(() => refuseSensitiveScreenshot('SENSITIVE', 'vision'), /cannot be redacted/);
  assert.doesNotThrow(() => refuseSensitiveScreenshot('SENSITIVE', 'a11y'));
  assert.doesNotThrow(() => refuseSensitiveScreenshot('NORMAL', 'vision'));
});
