import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopPolicy, DesktopWindowIdentity } from '../../protocol/src/desktop.js';
import { evaluateWindowGate } from '../src/window-gate.js';

test('evaluateWindowGate background direction denies unattributable targets even when unattributedInput is allow', () => {
  const policy: DesktopPolicy = {
    mode: 'denylist',
    applications: [],
    unattributedInput: 'allow',
  };

  const emptyIdentity: DesktopWindowIdentity = { windowId: 'win-1' };
  const verdict = evaluateWindowGate(emptyIdentity, policy, 'background');
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.attribution, 'unattributable');
  assert.match(verdict.reason, /window identity is unavailable for background target/);

  // But for legacy input direction, unattributedInput allow is respected
  const inputVerdict = evaluateWindowGate(emptyIdentity, policy, 'input');
  assert.equal(inputVerdict.allowed, true);
});

test('evaluateWindowGate background direction enforces denylist and allowlist', () => {
  const denylistPolicy: DesktopPolicy = {
    mode: 'denylist',
    applications: ['forbidden.exe'],
    unattributedInput: 'deny',
  };

  const allowedWin: DesktopWindowIdentity = {
    windowId: 'win-1',
    processName: 'app.exe',
  };
  const deniedWin: DesktopWindowIdentity = {
    windowId: 'win-2',
    processName: 'forbidden.exe',
  };

  assert.equal(evaluateWindowGate(allowedWin, denylistPolicy, 'background').allowed, true);
  assert.equal(evaluateWindowGate(deniedWin, denylistPolicy, 'background').allowed, false);

  const allowlistPolicy: DesktopPolicy = {
    mode: 'allowlist',
    applications: ['allowed.exe'],
    unattributedInput: 'deny',
  };

  const permittedWin: DesktopWindowIdentity = {
    windowId: 'win-3',
    processName: 'allowed.exe',
  };
  assert.equal(evaluateWindowGate(permittedWin, allowlistPolicy, 'background').allowed, true);
  assert.equal(evaluateWindowGate(allowedWin, allowlistPolicy, 'background').allowed, false);
});

test('evaluateWindowGate background direction enforces deniedTitlePatterns', () => {
  const policy: DesktopPolicy = {
    mode: 'denylist',
    applications: [],
    unattributedInput: 'deny',
    deniedTitlePatterns: ['Aevra', 'Sensitive Settings'],
  };

  const secretWin: DesktopWindowIdentity = {
    windowId: 'win-1',
    processName: 'browser.exe',
    title: 'Aevra',
  };
  const normalWin: DesktopWindowIdentity = {
    windowId: 'win-2',
    processName: 'browser.exe',
    title: 'Benign Page',
  };

  assert.equal(evaluateWindowGate(secretWin, policy, 'background').allowed, false);
  assert.equal(evaluateWindowGate(normalWin, policy, 'background').allowed, true);
});
