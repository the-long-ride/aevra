import type {
  BrowserActionInput,
  BrowserActionResult,
  BrowserLogEntry,
  BrowserLogKind,
  BrowserReadFormat,
  BrowserSessionInfo,
  BrowserSnapshotMode,
  BrowserSnapshotResult,
  BrowserTabAction,
  BrowserTabInfo,
  BrowserTransport,
} from '../../protocol/src/browser.js';

export interface ConnectOptions {
  transport: BrowserTransport;
  cdpPort?: number;
  tabId?: string;
}

export interface TabRequest {
  action: BrowserTabAction;
  url?: string;
  tabId?: string;
}

export interface NavigateRequest {
  tabId?: string;
  url: string;
  waitUntil: 'load' | 'idle';
}

export interface NavigateResult {
  tabId: string;
  url: string;
  status: number | null;
  redirected: boolean;
}

export interface SnapshotRequest {
  tabId?: string;
  mode: BrowserSnapshotMode;
  maxNodes: number;
}

export interface ReadRequest {
  tabId?: string;
  ref?: string;
  selector?: string;
  format: BrowserReadFormat;
}

export interface ReadResult {
  tabId: string;
  url: string;
  content: string;
}

export interface ActOptions {
  tabId?: string;
  stopOnError: boolean;
}

export interface LogsRequest {
  tabId?: string;
  logKind: BrowserLogKind;
  limit: number;
  since?: string;
}

/** Transport-level budget for one RPC when nothing in the batch asks for longer. */
export const DEFAULT_CALL_TIMEOUT_MS = 15_000;

/**
 * Longest `wait_for` a caller may ask for. `registry.run` holds the session
 * exclusively for the whole batch, so without a ceiling one action pins the
 * browser and the kill switch is the only way out.
 */
export const MAX_WAIT_FOR_MS = 120_000;

/** Room for the round trip either side of the wait the page is actually doing. */
const WAIT_MARGIN_MS = 5_000;

/**
 * Transport budget for an `act` batch, derived from the batch itself.
 *
 * A fixed 15s budget meant a `wait_for` above 15s failed on the extension
 * transport and worked on CDP, for the same call. `BrowserDriver.act` gains no
 * new parameter: the value follows from the actions the caller already sent.
 */
export function actTimeoutMs(actions: BrowserActionInput[]): number {
  const longest = actions.reduce(
    (max, action) =>
      action.op === 'wait_for' ? Math.max(max, Number(action.timeoutMs) || 0) : max,
    0,
  );
  if (longest <= 0) return DEFAULT_CALL_TIMEOUT_MS;
  return Math.min(
    MAX_WAIT_FOR_MS + WAIT_MARGIN_MS,
    Math.max(DEFAULT_CALL_TIMEOUT_MS, longest + WAIT_MARGIN_MS),
  );
}

export class BrowserDriverError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'BrowserDriverError';
  }
}

export interface BrowserDriver {
  readonly transport: BrowserTransport;
  connect(options: ConnectOptions): Promise<BrowserSessionInfo>;
  tabs(request: TabRequest): Promise<BrowserTabInfo[]>;
  navigate(request: NavigateRequest): Promise<NavigateResult>;
  snapshot(request: SnapshotRequest): Promise<BrowserSnapshotResult>;
  read(request: ReadRequest): Promise<ReadResult>;
  act(actions: BrowserActionInput[], options: ActOptions): Promise<BrowserActionResult[]>;
  logs(request: LogsRequest): Promise<BrowserLogEntry[]>;
  disconnect(): Promise<void>;
}
