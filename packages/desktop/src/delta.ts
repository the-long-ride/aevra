import type { DesktopActionDelta, DesktopWindowIdentity } from '../../protocol/src/desktop.js';

export interface ScreenState {
  window: DesktopWindowIdentity;
  windowIds: string[];
  /** Hash of the focused window's tree, computed by the helper. */
  signature: string;
}

/**
 * Returned with every action so the caller never has to re-describe just to
 * learn what happened. A full re-describe costs 1-3k tokens; this costs a few
 * dozen.
 */
export function computeDelta(before: ScreenState, after: ScreenState): DesktopActionDelta {
  const known = new Set(before.windowIds);
  return {
    focusChanged: before.window.windowId !== after.window.windowId,
    newWindow: after.windowIds.some((id) => !known.has(id)),
    subtreeChanged: before.signature !== after.signature,
  };
}
