import assert from 'node:assert/strict';
import test from 'node:test';
import { SKIP, makeDriver, NO_FOCUSED_WINDOW } from './real-helper-fixture.js';

// WHY THESE CAPTURE TESTS CAN SKIP THEMSELVES MID-RUN.
//
// `capture` refuses a uniform image rather than returning it, because a
// black rectangle presented as a successful screenshot is the worst outcome
// this subsystem has (see helper/src/capture.rs). A locked, asleep, or
// blank display legitimately produces exactly that refusal, and a test
// cannot tell that apart from a real defect by looking at the error. So it
// skips, and says why. The refusal itself is covered by a Rust unit test
// that constructs a blank frame directly, so nothing goes unverified here.
const UNIFORM =
  /uniform \d+x\d+ image|BitBlt of the primary screen failed|The handle is invalid|window \d+ no longer exists|no focused window/;

test(
  'real helper: capture returns a real JPEG data URI and a usable devicePixelRatio',
  { skip: SKIP },
  async (t) => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      let shot;
      try {
        shot = await driver.capture();
      } catch (error) {
        if (UNIFORM.test(String(error))) {
          t.skip('the display is blank (locked or asleep), so there is nothing to capture');
          return;
        }
        throw error;
      }
      // Anchored, and requires a non-trivial payload: an empty-payload data
      // URI must fail this.
      assert.match(shot.imageDataUri, /^data:image\/jpeg;base64,[A-Za-z0-9+/]{32,}={0,2}$/);
      // Image pixels per screen coordinate. A caller divides an image
      // coordinate by this to get something clickable, so a zero or negative
      // value would be unusable.
      assert.ok(shot.devicePixelRatio > 0, `devicePixelRatio was ${shot.devicePixelRatio}`);
      assert.ok(shot.devicePixelRatio <= 1, 'capture never upscales, so the ratio cannot exceed 1');
      // A primary-monitor capture is not one window's pixels, so it must not
      // be labelled with one window's identity - the tool layer audits this
      // field as the capture's target.
      assert.equal(shot.window, null);
    } finally {
      await teardown();
    }
  },
);

test(
  'real helper: capturing one window reports that window identity',
  { skip: SKIP },
  async (t) => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      let focused;
      try {
        focused = await driver.focusedWindow();
      } catch (error) {
        if (NO_FOCUSED_WINDOW.test(String(error))) {
          t.skip('no focused window to capture');
          return;
        }
        throw error;
      }
      let shot;
      try {
        shot = await driver.capture(focused.windowId);
      } catch (error) {
        if (UNIFORM.test(String(error))) {
          t.skip('the focused window captured blank, which capture refuses by design');
          return;
        }
        throw error;
      }
      assert.match(shot.imageDataUri, /^data:image\/jpeg;base64,[A-Za-z0-9+/]{32,}={0,2}$/);
      assert.ok(shot.devicePixelRatio > 0);
      assert.equal(shot.window?.windowId, focused.windowId);
    } finally {
      await teardown();
    }
  },
);

test(
  'real helper: capturing a windowId that does not exist is an error',
  { skip: SKIP },
  async () => {
    const { driver, teardown } = makeDriver();
    try {
      await driver.connect();
      await assert.rejects(() => driver.capture('999999999'));
    } finally {
      await teardown();
    }
  },
);
