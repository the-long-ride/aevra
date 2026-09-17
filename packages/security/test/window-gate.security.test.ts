import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWindowGate } from '../src/window-gate.js';
import type { DesktopPolicy } from '../../protocol/src/desktop.js';

const allowlist: DesktopPolicy = {
  mode: 'allowlist',
  applications: ['notepad.exe'],
  unattributedInput: 'deny',
};
const denylist: DesktopPolicy = {
  mode: 'denylist',
  applications: ['cmd.exe'],
  unattributedInput: 'deny',
};
const named = { windowId: 'w1', processName: 'notepad.exe', title: 'Untitled' };
const blocked = { windowId: 'w2', processName: 'cmd.exe', title: 'Command Prompt' };
const nameless = { windowId: 'w3' };

test('capture is permitted in all three attribution states', () => {
  const namedVerdict = evaluateWindowGate(named, allowlist, 'capture');
  const blockedVerdict = evaluateWindowGate(blocked, allowlist, 'capture');
  const namelessVerdict = evaluateWindowGate(nameless, allowlist, 'capture');
  for (const verdict of [namedVerdict, blockedVerdict, namelessVerdict]) {
    assert.equal(verdict.allowed, true);
  }
  assert.equal(namedVerdict.attribution, 'attributed');
  assert.equal(blockedVerdict.attribution, 'attributed');
  assert.equal(namelessVerdict.attribution, 'unattributable');
});

test('input follows the allowlist', () => {
  assert.equal(evaluateWindowGate(named, allowlist, 'input').allowed, true);
  assert.equal(evaluateWindowGate(blocked, allowlist, 'input').allowed, false);
});

test('input follows the denylist', () => {
  assert.equal(evaluateWindowGate(named, denylist, 'input').allowed, true);
  assert.equal(evaluateWindowGate(blocked, denylist, 'input').allowed, false);
});

test('INVERSION: unattributable refuses input under both modes', () => {
  // Identity suppression correlates with sensitivity - the Windows UAC secure
  // desktop and macOS secure input fields are both unattributable. Permitting
  // input here would grant the most access exactly where the OS signals the
  // most caution.
  for (const policy of [allowlist, denylist]) {
    const verdict = evaluateWindowGate(nameless, policy, 'input');
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.attribution, 'unattributable');
  }
});

test('the opt-in flips unattributable input to permitted, and nothing else', () => {
  const opened: DesktopPolicy = { ...allowlist, unattributedInput: 'allow' };
  assert.equal(evaluateWindowGate(nameless, opened, 'input').allowed, true);
  // An attributed, explicitly refused window stays refused. The opt-in covers
  // the unknown case only; it is not a global override.
  assert.equal(evaluateWindowGate(blocked, opened, 'input').allowed, false);
});

test('BYPASS: an executablePath-only identity on the denylist is refused for input', () => {
  // Regression for the plan's reference bug: attributed() treats
  // executablePath as sufficient for attribution, but matches() used to
  // check only processName, so a denylisted app with no processName slipped
  // through as allowed=true. Attribution and matching must agree.
  const identity = { windowId: 'w4', executablePath: 'C:\\Windows\\System32\\cmd.exe' };
  const verdict = evaluateWindowGate(identity, denylist, 'input');
  assert.equal(verdict.attribution, 'attributed');
  assert.equal(verdict.allowed, false);
});

test('an executablePath-only identity NOT on the denylist is permitted for input', () => {
  const identity = { windowId: 'w5', executablePath: 'C:\\Program Files\\Notepad\\notepad.exe' };
  const verdict = evaluateWindowGate(identity, denylist, 'input');
  assert.equal(verdict.attribution, 'attributed');
  assert.equal(verdict.allowed, true);
});

test('an executablePath-only identity on the allowlist is permitted for input', () => {
  const identity = { windowId: 'w6', executablePath: 'C:\\Windows\\System32\\notepad.exe' };
  const verdict = evaluateWindowGate(identity, allowlist, 'input');
  assert.equal(verdict.attribution, 'attributed');
  assert.equal(verdict.allowed, true);
});

test('matches() is case-insensitive on both the policy entry and the identity', () => {
  const policy: DesktopPolicy = {
    mode: 'allowlist',
    applications: ['Notepad.exe'],
    unattributedInput: 'deny',
  };
  const identity = { windowId: 'w7', processName: 'notepad.exe' };
  assert.equal(evaluateWindowGate(identity, policy, 'input').allowed, true);
});

test('FINDING A: a trailing separator on executablePath must not erase the basename', () => {
  // basename() used to split on [\\/] and guard the result with `!== ''`.
  // A path ending in a separator splits to a final segment of '', which the
  // guard then skipped entirely, so the denylisted executable matched
  // nothing and was granted input (allowed = !listed = true). Stripping
  // trailing separators before splitting closes this.
  const identity = { windowId: 'w8', executablePath: 'C:\\Windows\\System32\\cmd.exe\\' };
  const verdict = evaluateWindowGate(identity, denylist, 'input');
  assert.equal(verdict.attribution, 'attributed');
  assert.equal(verdict.allowed, false);
});

test('FINDING A: basename() handles a POSIX-style executablePath', () => {
  const identity = { windowId: 'w9', executablePath: '/usr/bin/cmd.exe' };
  const verdict = evaluateWindowGate(identity, denylist, 'input');
  assert.equal(verdict.attribution, 'attributed');
  assert.equal(verdict.allowed, false);
});

test('FINDING A: basename() handles a bare filename with no separator', () => {
  const identity = { windowId: 'w10', executablePath: 'cmd.exe' };
  const verdict = evaluateWindowGate(identity, denylist, 'input');
  assert.equal(verdict.attribution, 'attributed');
  assert.equal(verdict.allowed, false);
});

test('FINDING A: an empty-string executablePath stays unattributable', () => {
  // Boolean('') is false, so attributed() must treat an empty-string
  // executablePath the same as an absent one. Confirming this behaviour,
  // not changing it.
  const identity = { windowId: 'w11', executablePath: '' };
  const verdict = evaluateWindowGate(identity, denylist, 'input');
  assert.equal(verdict.attribution, 'unattributable');
  assert.equal(verdict.allowed, false);
});

test('FINDING B: a mismatched processName/executablePath pair is refused under allowlist', () => {
  // processName reports something not on the allowlist while executablePath
  // points at a listed app. An OR-over-fields match would let this in on the
  // path alone even though the reported process name is not listed. Under
  // allowlist every present field must agree.
  const identity = {
    windowId: 'w12',
    processName: 'evil.exe',
    executablePath: 'C:\\Windows\\System32\\notepad.exe',
  };
  const verdict = evaluateWindowGate(identity, allowlist, 'input');
  assert.equal(verdict.attribution, 'attributed');
  assert.equal(verdict.allowed, false);
});

test('FINDING B: a mismatched processName/executablePath pair is refused under denylist if either field is listed', () => {
  // Denylist keeps the safe OR direction: either field matching is enough to
  // refuse, regardless of what the other field says.
  const pathListed = {
    windowId: 'w13',
    processName: 'notepad.exe',
    executablePath: 'C:\\Windows\\System32\\cmd.exe',
  };
  const processListed = {
    windowId: 'w14',
    processName: 'cmd.exe',
    executablePath: 'C:\\Program Files\\Notepad\\notepad.exe',
  };
  assert.equal(evaluateWindowGate(pathListed, denylist, 'input').allowed, false);
  assert.equal(evaluateWindowGate(processListed, denylist, 'input').allowed, false);
});

test('FINDING B: the ordinary case where both fields agree still matches under allowlist', () => {
  // Regression guard: existing behaviour for the common case (processName
  // and executablePath naming the same app) must be unchanged by the
  // direction split.
  const identity = {
    windowId: 'w15',
    processName: 'notepad.exe',
    executablePath: 'C:\\Windows\\notepad.exe',
  };
  assert.equal(evaluateWindowGate(identity, allowlist, 'input').allowed, true);
});

test('M2/M3: an executablePath of only separators is unattributable, not attributed', () => {
  // basename() strips trailing separators then splits on the rest; a path
  // that is NOTHING but separators strips to '' either way, so
  // presentFields() correctly finds no usable field. The old attributed()
  // used `Boolean(identity.processName ?? identity.executablePath)`, which
  // is true for any non-empty string including these -- so the gate used to
  // call this identity "attributed", run it through matches() (which
  // correctly found nothing to match), and grant a denylist's default-allow
  // to a window nothing here actually vouches for.
  for (const executablePath of ['\\', '/', '\\\\']) {
    const identity = { windowId: 'w16', executablePath };
    const verdict = evaluateWindowGate(identity, denylist, 'input');
    assert.equal(
      verdict.attribution,
      'unattributable',
      `executablePath=${JSON.stringify(executablePath)}`,
    );
    assert.equal(verdict.allowed, false, `executablePath=${JSON.stringify(executablePath)}`);
  }
});

test('M2/M3: an empty-string processName does not mask a usable executablePath', () => {
  // The old attributed() short-circuited on `identity.processName ??
  // identity.executablePath`: '' is not null/undefined, so `??` never fell
  // through to executablePath, and Boolean('') is false -- reporting
  // unattributable even though executablePath alone is perfectly usable.
  // presentFields() looks at each field on its own merits, so an
  // empty-string processName is simply skipped and the executablePath still
  // counts.
  const identity = {
    windowId: 'w17',
    processName: '',
    executablePath: 'C:\\Windows\\System32\\cmd.exe',
  };
  const verdict = evaluateWindowGate(identity, denylist, 'input');
  assert.equal(verdict.attribution, 'attributed');
  assert.equal(verdict.allowed, false);
});
