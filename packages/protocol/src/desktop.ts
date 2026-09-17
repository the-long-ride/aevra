export const DESKTOP_OPERATION_KINDS = [
  'desktop.connect',
  'desktop.status',
  'desktop.disconnect',
  'desktop.apps',
  'desktop.windows',
  'desktop.describe',
  'desktop.capture',
  'desktop.act',
] as const;

export type DesktopOperationKind = (typeof DESKTOP_OPERATION_KINDS)[number];

/** What the gate judges. Every field may be absent on an unattributable window. */
export interface DesktopWindowIdentity {
  windowId: string;
  processName?: string;
  executablePath?: string;
  title?: string;
}

export interface DesktopNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  enabled: boolean;
  focused: boolean;
  children?: DesktopNode[];
}

/** Independent by design: a host may see without acting. */
export interface DesktopCapabilities {
  capture: boolean;
  tree: boolean;
  attribution: boolean;
  input: boolean;
}

/** Returned by every action so the caller need not re-describe. */
export interface DesktopActionDelta {
  focusChanged: boolean;
  newWindow: boolean;
  subtreeChanged: boolean;
  /**
   * Set only when the action itself completed but the post-action screen read
   * that `computeDelta` needs then failed. The three flags above are, in that
   * case, a conservative guess (all `true`) rather than an observation -- the
   * driver could not see what actually changed. A caller must not treat them
   * as fact: it should re-describe the screen before deciding anything landed
   * or did not. Absent (or `false`) means the flags above came from a real
   * before/after comparison.
   */
  postActionStateUnknown?: boolean;
}

export interface DesktopPolicy {
  mode: 'allowlist' | 'denylist';
  applications: string[];
  /**
   * Whether `executablePath` fields reported by desktop tools (desktop_apps,
   * desktop_windows, desktop_describe, desktop_capture) are sent to the
   * model in full, or collapsed to just the executable's basename. Defaults
   * to collapsed (false/absent) - the model sees "notepad.exe", not
   * "C:\Windows\notepad.exe", unless an operator opts in.
   */
  exposeExecutablePaths?: boolean;
  unattributedInput: 'allow' | 'deny';
  /**
   * Optional, additive defense-in-depth: when set, input is refused whenever
   * the focused window's title case-insensitively EQUALS one of these
   * patterns in full (not a substring match), regardless of what the
   * allowlist/denylist decided.
   *
   * Exact, not substring: a substring rule would also refuse input to any
   * window whose title merely CONTAINS a pattern -- an editor with this repo
   * open, a browser tab on this project's GitHub page -- with no security
   * benefit, since none of those windows ARE the thing the pattern names.
   * See `titleDenied` in `packages/security/src/window-gate.ts` for the
   * implementation and the fuller reasoning.
   *
   * This exists because a process-name denylist cannot express "Aevra's own
   * admin UI" -- that UI is a web page, so at window granularity its identity
   * IS the browser's process, and denylisting the browser would deny the
   * whole surface a desktop agent needs. Titles are attacker-influenceable
   * (any page can set `document.title` to anything), so this can only ever
   * narrow what is permitted, never widen it, and must never be treated as
   * proof of identity -- it is one more speed bump, not a fix.
   */
  deniedTitlePatterns?: string[];
}

export interface DesktopDescribeResult {
  window: DesktopWindowIdentity;
  nodes: DesktopNode[];
  truncated: boolean;
}

export interface DesktopCaptureResult {
  imageDataUri: string;
  devicePixelRatio: number;
  window: DesktopWindowIdentity | null;
}

/** One installed app resolved from the OS's own app inventory. */
export interface DetectedApp {
  displayName: string;
  version: string | null;
  executablePath: string;
  exeBasename: string;
}
