import type {
  DesktopActionDelta,
  DesktopCapabilities,
  DesktopCaptureResult,
  DesktopDescribeResult,
  DesktopNode,
  DesktopTargetIdentity,
  DesktopWindowInstance,
  DesktopWindowIdentity,
} from '../../protocol/src/desktop.js';

export interface DescribeRequest {
  windowId?: string;
  maxNodes: number;
  interactiveOnly: boolean;
  mode?: 'foreground' | 'background';
}

export interface ActRequest {
  op: 'click' | 'type' | 'key' | 'scroll';
  ref?: string;
  x?: number;
  y?: number;
  text?: string;
  keys?: string;
  deltaY?: number;
}

export interface ActResult {
  ok: boolean;
  delta: DesktopActionDelta;
  /**
   * The window the gate judged this action against, and its verdict plus the
   * deciding rule - attached by `dispatchDesktopOperation` (Worker is the
   * only place that observes focus at action time), and read by the MCP
   * tool layer's audit call. Optional because a caller that constructs an
   * `ActResult` directly (tests, older callers) need not supply it, but the
   * real dispatch path always does, for both the allowed and refused paths.
   */
  window?: DesktopWindowIdentity;
  gateVerdict?: 'allow' | 'deny';
  gateRule?: string;
}

export class DesktopDriverError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`${code}: ${message}`);
    this.name = 'DesktopDriverError';
  }
}

export interface DesktopDriver {
  connect(): Promise<DesktopCapabilities>;
  windows(): Promise<DesktopWindowIdentity[]>;
  /** Identity of the window an action would land on, resolved at action time. */
  focusedWindow(): Promise<DesktopWindowIdentity>;
  describe(request: DescribeRequest): Promise<DesktopDescribeResult>;
  capture(windowId?: string): Promise<DesktopCaptureResult>;
  act(request: ActRequest): Promise<ActResult>;
  disconnect(): Promise<void>;

  targetIdentity?(windowId: string): Promise<DesktopTargetIdentity>;
  describeBackground?(request: {
    windowId: string;
    snapshotId: string;
    maxNodes: number;
    interactiveOnly: boolean;
  }): Promise<{
    window: DesktopWindowIdentity;
    windowInstance: DesktopWindowInstance;
    hostApplication?: DesktopTargetIdentity['hostApplication'];
    nodes: DesktopNode[];
    truncated: boolean;
  }>;
  releaseBackgroundSnapshot?(snapshotId: string): Promise<boolean>;
  backgroundAct?(request: {
    snapshotId: string;
    handle: string;
    op: string;
    value?: string;
    expectedInstance: DesktopWindowInstance;
    expectedHost?: DesktopTargetIdentity['hostApplication'];
  }): Promise<{
    ok: boolean;
    outcome: string;
    focusChanged: boolean;
    toggleState?: 'off' | 'on' | 'indeterminate';
  }>;
}
