import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDesktopPolicy } from '../src/desktop-policy-defaults.js';
import { evaluateWindowGate } from '../src/window-gate.js';

test('protected admin titles remain protected with real browser suffixes', () => {
  for (const title of ['Aevra - Google Chrome', 'Aevra � Mozilla Firefox', 'Aevra - Brave']) {
    assert.equal(
      evaluateWindowGate(
        { windowId: 'one', processName: 'chrome.exe', title },
        defaultDesktopPolicy(),
        'input',
      ).allowed,
      false,
      title,
    );
  }
  assert.equal(
    evaluateWindowGate(
      { windowId: 'one', processName: 'code.exe', title: 'aevra repository - Visual Studio Code' },
      defaultDesktopPolicy(),
      'input',
    ).allowed,
    true,
  );
});

test('desktop reads refuse denylisted applications and protected titles', () => {
  for (const identity of [
    { windowId: 'one', processName: '1Password.exe' },
    { windowId: 'two', processName: 'chrome.exe', title: 'Aevra - Google Chrome' },
  ]) {
    assert.equal(evaluateWindowGate(identity, defaultDesktopPolicy(), 'capture').allowed, false);
  }
  assert.equal(
    evaluateWindowGate(
      { windowId: 'safe', processName: 'notepad.exe' },
      defaultDesktopPolicy(),
      'capture',
    ).allowed,
    true,
  );
});
