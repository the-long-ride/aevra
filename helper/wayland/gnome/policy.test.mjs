import assert from 'node:assert/strict';
import test from 'node:test';
import { Access, eligibleHelper, keyboardAllowed, frameCrop, shellHasKeyFocus } from './policy.js';

test('only actual same-user Aevra helper paths can request compositor permission', () => {
  assert.ok(eligibleHelper('/opt/aevra/aevra-desktop-helper', 1000, 1000));
  assert.ok(eligibleHelper('/home/user/bin/aevra-desktop', 1000, 1000));
  for (const path of [
    '/usr/bin/gdbus',
    'aevra-desktop-helper',
    '/tmp/aevra-desktop-helper (deleted)',
    '/tmp/not-aevra-desktop',
  ])
    assert.equal(eligibleHelper(path, 1000, 1000), false);
  assert.equal(eligibleHelper('/opt/aevra/aevra-desktop-helper', 0, 1000), false);
});

test('disabled, locked and revoked connections never regain authority implicitly', () => {
  const access = new Access();
  assert.throws(() => access.open(':1.2'), /PERMISSION/);
  access.enable(true);
  access.open(':1.2');
  access.require(':1.2', false);
  assert.throws(() => access.require(':1.2', true), /PERMISSION/);
  access.enable(false);
  access.enable(true);
  assert.throws(() => access.require(':1.2', false), /PERMISSION/);
  access.open(':1.3');
  access.close(':1.3');
  assert.throws(() => access.require(':1.3', false), /PERMISSION/);
});

test('input requires exact target PID/focus and integer finite coordinates', () => {
  const access = new Access();
  access.enable(true);
  access.open(':1.2');
  const window = { id: 7, pid: 42, focused: true, rect: { x: -20, y: 0, width: 400, height: 200 } };
  access.target(':1.2', false, { id: 7, pid: 42 }, window);
  for (const changed of [
    { ...window, id: 8 },
    { ...window, pid: 43 },
    { ...window, focused: false },
  ])
    assert.throws(
      () => access.target(':1.2', false, { id: 7, pid: 42 }, changed),
      /TARGET_CHANGED/,
    );
  assert.throws(() => access.point(window, NaN, 3), /INPUT_REFUSED/);
  assert.throws(() => access.point(window, 380, 3), /INPUT_REFUSED/);
  assert.throws(() => access.point(window, 2, 201), /INPUT_REFUSED/);
  access.point(window, -20, 0);
});

test('keyboard effects refuse Shell ownership even while the app MetaWindow stays focused', () => {
  const native = {
    modalCount: 0,
    overview: false,
    shellKeyFocus: false,
    normalMode: true,
    nativeTextFocus: true,
  };
  assert.equal(keyboardAllowed(native, true), true);
  for (const changed of [
    { modalCount: 1 },
    { overview: true },
    { shellKeyFocus: true },
    { normalMode: false },
    { nativeTextFocus: false },
  ])
    assert.equal(keyboardAllowed({ ...native, ...changed }, true), false);
  assert.equal(keyboardAllowed({ ...native, nativeTextFocus: false }, false), true);
});

test('window-only capture crops verified frame out of decorated buffer at native scale', () => {
  const frame = { x: 440, y: 278, width: 400, height: 277 },
    buffer = { x: 414, y: 255, width: 452, height: 329 };
  assert.deepEqual(frameCrop(frame, buffer, 452, 329), { x: 26, y: 23, width: 400, height: 277 });
  assert.deepEqual(frameCrop(frame, buffer, 904, 658), { x: 52, y: 46, width: 800, height: 554 });
  const fractional = frameCrop(frame, buffer, 565, 411);
  assert.equal(fractional.width, 500);
  assert.equal(fractional.height, 346);
  assert.throws(() => frameCrop({ ...frame, x: 0 }, buffer, 452, 329));
});

test('GNOME stage fallback is not Shell keyboard ownership', () => {
  const stage = {};
  assert.equal(shellHasKeyFocus(null, stage), false);
  assert.equal(shellHasKeyFocus(stage, stage), false);
  assert.equal(shellHasKeyFocus({}, stage), true);
  assert.equal(shellHasKeyFocus(undefined, stage), true);
});
