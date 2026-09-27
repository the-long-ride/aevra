export type BrowserTransport = 'extension' | 'cdp';
export type BrowserOriginClass = 'BLOCKED' | 'SENSITIVE' | 'NORMAL';
export type BrowserSnapshotMode = 'a11y' | 'vision';
export type BrowserReadFormat = 'text' | 'html';
export type BrowserLogKind = 'console' | 'network';
export type BrowserTabAction = 'list' | 'open' | 'close' | 'focus';

/** Internal Core-to-worker authorization record; never returned by admin APIs. */
export interface BrowserExtensionPairing {
  pairingId: string;
  profileId: string | null;
  profileName: string;
  extensionId: string;
  credentialId: string | null;
  legacy: boolean;
}

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
   * image-pixels-per-CSS-pixel scale. Both transports capture the visible
   * viewport as a JPEG at CSS scale, or below it when the viewport exceeds the
   * vision budget (`packages/browser/src/vision-budget.ts`), so it is 1 or
   * less. Coordinate actions are converted back by the ratio of the tab's last
   * vision capture; before any capture they are taken as CSS pixels.
   */
  devicePixelRatio?: number;
  /**
   * Vision mode only. The returned image's own size - the space `{x, y}` and
   * boxes are in. A lower JPEG quality leaves it unchanged; only a size step
   * of the capture budget shrinks it, and `devicePixelRatio` follows.
   */
  imageWidth?: number;
  imageHeight?: number;
  /** Vision mode only. The visible viewport the image was taken of, in CSS pixels. */
  viewport?: { width: number; height: number };
  boxes?: Array<{ ref: string; label: string; box: BrowserBox }>;
}

export type BrowserActionInput =
  | { op: 'click'; ref?: string; selector?: string; x?: number; y?: number }
  | { op: 'drag'; x: number; y: number; toX: number; toY: number }
  | { op: 'type'; ref?: string; selector?: string; text: string; clear?: boolean }
  | { op: 'press_key'; key: string }
  | {
      op: 'scroll';
      ref?: string;
      selector?: string;
      x?: number;
      y?: number;
      dx: number;
      dy: number;
    }
  | { op: 'select'; ref?: string; selector?: string; value: string }
  | { op: 'wait_for'; ref?: string; selector?: string; text?: string; timeoutMs: number };

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

export interface BrowserListenerHealth {
  state: 'stopped' | 'listening' | 'failed';
  port: number;
  errorCode: string | null;
  changedAt: string;
}

export interface BrowserWorkerHealth {
  listener: BrowserListenerHealth;
  extensionSocketAuthenticated: boolean;
  workerExtensionId: string | null;
  workerEpoch: number;
  activePairingId?: string | null;
  activeProfileId?: string | null;
  activeProfileName?: string | null;
  activeExtensionId?: string | null;
}
