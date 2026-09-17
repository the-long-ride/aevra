export type BrowserTransport = 'extension' | 'cdp';
export type BrowserOriginClass = 'BLOCKED' | 'SENSITIVE' | 'NORMAL';
export type BrowserSnapshotMode = 'a11y' | 'vision';
export type BrowserReadFormat = 'text' | 'html';
export type BrowserLogKind = 'console' | 'network';
export type BrowserTabAction = 'list' | 'open' | 'close' | 'focus';

export interface BrowserTabInfo {
  tabId: string;
  url: string;
  title: string;
  active: boolean;
  originClass: BrowserOriginClass;
}

export interface BrowserBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserSnapshotNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  credentialField?: boolean;
  box?: BrowserBox;
  children?: BrowserSnapshotNode[];
}

export interface BrowserSnapshotResult {
  tabId: string;
  url: string;
  originClass: BrowserOriginClass;
  snapshotVersion: number;
  mode: BrowserSnapshotMode;
  nodes?: BrowserSnapshotNode[];
  truncated?: boolean;
  imageDataUri?: string;
  /**
   * Vision mode only. Boxes are in the screenshot's own pixel space, which is
   * also the space `{x, y}` action coordinates are read in - so a model that
   * points at what it sees in the image lands on the right element. This is the
   * image-pixels-per-CSS-pixel scale: 1 on CDP, which captures at CSS scale, and
   * the display's device pixel ratio on the extension transport, whose capture
   * API offers no scale control.
   */
  devicePixelRatio?: number;
  boxes?: Array<{ ref: string; label: string; box: BrowserBox }>;
}

export type BrowserActionInput =
  | { op: 'click'; ref?: string; x?: number; y?: number }
  | { op: 'type'; ref: string; text: string; clear?: boolean }
  | { op: 'press_key'; key: string }
  | { op: 'scroll'; ref?: string; x?: number; y?: number; dx: number; dy: number }
  | { op: 'select'; ref: string; value: string }
  | { op: 'wait_for'; ref?: string; text?: string; timeoutMs: number };

export interface BrowserActionResult {
  op: BrowserActionInput['op'];
  ok: boolean;
  detail?: string;
  error?: { code: string; message: string };
}

export interface BrowserLogEntry {
  at: string;
  kind: BrowserLogKind;
  level?: string;
  text: string;
  url?: string;
  status?: number;
}

export interface BrowserSessionInfo {
  sessionId: string;
  transport: BrowserTransport;
  connected: boolean;
  tabs: BrowserTabInfo[];
}

export const BROWSER_OPERATION_KINDS = [
  'browser.connect',
  'browser.tabs',
  'browser.navigate',
  'browser.snapshot',
  'browser.read',
  'browser.act',
  'browser.logs',
  'browser.disconnect',
  'browser.status',
] as const;

export type BrowserOperationKind = (typeof BROWSER_OPERATION_KINDS)[number];
