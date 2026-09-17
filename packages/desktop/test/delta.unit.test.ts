import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDelta } from '../src/delta.js';

const window1 = { windowId: 'w1', processName: 'notepad.exe' };
const window2 = { windowId: 'w2', processName: 'notepad.exe' };

test('a changed focused window is reported as a focus change', () => {
  const delta = computeDelta(
    { window: window1, windowIds: ['w1'], signature: 'a' },
    { window: window2, windowIds: ['w1', 'w2'], signature: 'a' },
  );
  assert.equal(delta.focusChanged, true);
  assert.equal(delta.newWindow, true);
});

test('an unchanged screen reports no change at all', () => {
  const state = { window: window1, windowIds: ['w1'], signature: 'a' };
  assert.deepEqual(computeDelta(state, state), {
    focusChanged: false,
    newWindow: false,
    subtreeChanged: false,
  });
});

test('a changed subtree signature is reported', () => {
  const delta = computeDelta(
    { window: window1, windowIds: ['w1'], signature: 'a' },
    { window: window1, windowIds: ['w1'], signature: 'b' },
  );
  assert.equal(delta.subtreeChanged, true);
});

test('a closed window is not reported as a new window', () => {
  // `newWindow` asks whether something APPEARED, so a window going away must not
  // trip it. Set difference in the wrong direction would.
  const delta = computeDelta(
    { window: window1, windowIds: ['w1', 'w2'], signature: 'a' },
    { window: window1, windowIds: ['w1'], signature: 'a' },
  );
  assert.equal(delta.newWindow, false);
});
