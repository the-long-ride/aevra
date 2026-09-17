import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWindowGate } from '../src/window-gate.js';
import { defaultDesktopPolicy } from '../src/desktop-policy-defaults.js';

test('the default policy refuses input to a terminal', () => {
  const identity = { windowId: 'w1', processName: 'powershell.exe', title: 'Windows PowerShell' };
  const verdict = evaluateWindowGate(identity, defaultDesktopPolicy(), 'input');
  assert.equal(verdict.allowed, false);
});

test('the default policy refuses input to a password manager', () => {
  const identity = { windowId: 'w2', processName: '1Password.exe', title: '1Password' };
  const verdict = evaluateWindowGate(identity, defaultDesktopPolicy(), 'input');
  assert.equal(verdict.allowed, false);
});

test('the default policy refuses input to the UAC consent dialog', () => {
  const identity = { windowId: 'w3', processName: 'consent.exe', title: 'User Account Control' };
  const verdict = evaluateWindowGate(identity, defaultDesktopPolicy(), 'input');
  assert.equal(verdict.allowed, false);
});

test('the default policy refuses input to an unattributable window', () => {
  const identity = { windowId: 'w4' };
  const verdict = evaluateWindowGate(identity, defaultDesktopPolicy(), 'input');
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.attribution, 'unattributable');
});

test('the default policy permits input to an ordinary application', () => {
  const identity = { windowId: 'w5', processName: 'notepad.exe', title: 'Untitled - Notepad' };
  const verdict = evaluateWindowGate(identity, defaultDesktopPolicy(), 'input');
  assert.equal(verdict.allowed, true);
});

test('LIMITATION: the denylist alone cannot single out the admin UI, which shares the browser process', () => {
  // This is the documented gap: the admin UI's window identity IS the
  // browser's, so an ordinary, non-denylisted browser process is permitted
  // even when it happens to be showing Aevra's own admin page. The title
  // check below is the only (partial) mitigation available at this layer.
  const browserShowingAdminUi = { windowId: 'w6', processName: 'msedge.exe', title: 'Aevra' };
  const ordinaryBrowserTab = { windowId: 'w7', processName: 'msedge.exe', title: 'Example Domain' };
  assert.equal(
    evaluateWindowGate(ordinaryBrowserTab, defaultDesktopPolicy(), 'input').allowed,
    true,
  );
  // With the title-based partial defense in place, the admin UI's own
  // browser tab IS refused - but only because its title happens to match
  // exactly, never because the browser process was identified as Aevra's.
  const verdict = evaluateWindowGate(browserShowingAdminUi, defaultDesktopPolicy(), 'input');
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /defense in depth only/);
});

test('the title check is an EXACT match, so a window merely mentioning "Aevra" is not blocked', () => {
  // Fix for the over-broad substring match: an editor with this repo open, a
  // browser tab on Aevra's GitHub page, or a file manager in an "aevra"
  // directory must not lose input just because the word appears somewhere in
  // the title. None of these windows IS the admin UI (whose title is exactly
  // "Aevra"), so none should be refused by this mitigation.
  const editorWithRepoOpen = {
    windowId: 'w8',
    processName: 'Code.exe',
    title: 'desktop-tools.ts - aevra - Visual Studio Code',
  };
  const githubTab = { windowId: 'w9', processName: 'msedge.exe', title: 'the-long-ride/aevra' };
  assert.equal(
    evaluateWindowGate(editorWithRepoOpen, defaultDesktopPolicy(), 'input').allowed,
    true,
  );
  assert.equal(evaluateWindowGate(githubTab, defaultDesktopPolicy(), 'input').allowed, true);
});

test('LIMITATION: this check only ever sees the ACTIVE tab, so an admin UI in a background tab is invisible to it', () => {
  // No pattern can close this gap (see the comments on `titleDenied` and
  // `defaultDesktopPolicy`): an OS window title is a property of the
  // currently-focused tab only. A browser whose focused tab shows something
  // unrelated - while the admin UI sits open behind it in another tab -
  // presents exactly this identity, and this check has no way to know the
  // admin UI is one Ctrl+Tab away. It is neither refused nor flagged.
  const backgroundedAdminUi = {
    windowId: 'w10',
    processName: 'msedge.exe',
    title: 'Example Domain',
  };
  const verdict = evaluateWindowGate(backgroundedAdminUi, defaultDesktopPolicy(), 'input');
  assert.equal(verdict.allowed, true);
});
