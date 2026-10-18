// Pure permission and target checks shared by the compositor and regression tests.
export function eligibleHelper(path, peerUid, ownerUid) {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    peerUid === ownerUid &&
    ['aevra-desktop-helper', 'aevra-desktop'].includes(path.split('/').pop())
  );
}
export class Access {
  constructor() {
    this.enabled = false;
    this.owners = new Set();
  }
  enable(value) {
    this.enabled = value;
    if (!value) this.owners.clear();
  }
  open(owner) {
    if (!this.enabled) throw Error('DESKTOP_PERMISSION_REQUIRED');
    this.owners.add(owner);
  }
  require(owner, locked) {
    if (!this.enabled || locked || !this.owners.has(owner))
      throw Error('DESKTOP_PERMISSION_REQUIRED');
  }
  close(owner) {
    this.owners.delete(owner);
  }
  target(owner, locked, expected, actual) {
    this.require(owner, locked);
    if (!actual || actual.id !== expected.id || actual.pid !== expected.pid || !actual.focused)
      throw Error('DESKTOP_TARGET_CHANGED');
  }
  point(window, x, y) {
    const r = window.rect;
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < r.x ||
      y < r.y ||
      x >= r.x + r.width ||
      y >= r.y + r.height
    )
      throw Error('DESKTOP_INPUT_REFUSED');
  }
}

// GNOME 46 returns the stage itself when no Shell actor owns keyboard focus.
export function shellHasKeyFocus(focus, stage) {
  return focus !== null && focus !== stage;
}

// MetaWindow focus does not imply keyboard ownership while Shell holds a grab.
export function keyboardAllowed(state, text) {
  return (
    state.modalCount === 0 &&
    !state.overview &&
    !state.shellKeyFocus &&
    state.normalMode &&
    (!text || state.nativeTextFocus)
  );
}

// Crop only this window actor; never substitute monitor pixels.
export function frameCrop(frame, buffer, textureWidth, textureHeight) {
  const positive = (r) =>
    r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
  if (
    !positive(frame) ||
    !positive(buffer) ||
    textureWidth <= 0 ||
    textureHeight <= 0 ||
    frame.x < buffer.x ||
    frame.y < buffer.y ||
    frame.x + frame.width > buffer.x + buffer.width ||
    frame.y + frame.height > buffer.y + buffer.height
  )
    throw Error('DESKTOP_CAPTURE_UNSUPPORTED');
  const sx = textureWidth / buffer.width,
    sy = textureHeight / buffer.height;
  const crop = {
    x: Math.round((frame.x - buffer.x) * sx),
    y: Math.round((frame.y - buffer.y) * sy),
    width: Math.round(frame.width * sx),
    height: Math.round(frame.height * sy),
  };
  if (
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > textureWidth ||
    crop.y + crop.height > textureHeight
  )
    throw Error('DESKTOP_CAPTURE_UNSUPPORTED');
  return crop;
}
