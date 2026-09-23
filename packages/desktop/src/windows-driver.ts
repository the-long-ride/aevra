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
import { computeDelta, type ScreenState } from './delta.js';
import {
  DesktopDriverError,
  type ActRequest,
  type ActResult,
  type DescribeRequest,
  type DesktopDriver,
} from './driver.js';
import type { HelperProcess } from './helper-process.js';

// Built fresh per call when the action completed but the trailing screenState
// read that feeds computeDelta failed. All three flags are set true
// deliberately: a caller that ignores `postActionStateUnknown` and just reads
// the flags still re-describes rather than wrongly concluding nothing
// changed. A fresh object per call (rather than one shared constant) keeps a
// caller mutating its returned delta from corrupting every other degraded
// `act()` in the process.
function makeUnreliableDelta(): DesktopActionDelta {
  return {
    focusChanged: true,
    newWindow: true,
    subtreeChanged: true,
    postActionStateUnknown: true,
  };
}

export class WindowsDesktopDriver implements DesktopDriver {
  private refs = new Map<string, string>();
  private nextRefId = 1;

  constructor(private readonly helper: HelperProcess) {}

  connect(): Promise<DesktopCapabilities> {
    return this.helper.call<DesktopCapabilities>('connect', {});
  }

  windows(): Promise<DesktopWindowIdentity[]> {
    return this.helper.call<DesktopWindowIdentity[]>('windows', {});
  }

  focusedWindow(): Promise<DesktopWindowIdentity> {
    return this.helper.call<DesktopWindowIdentity>('focusedWindow', {});
  }

  async describe(request: DescribeRequest): Promise<DesktopDescribeResult> {
    const raw = await this.helper.call<{
      window: DesktopWindowIdentity;
      nodes: (Omit<DesktopNode, 'ref'> & { handle: string })[];
      truncated: boolean;
      snapshotId?: string;
      windowLeaseId?: string;
      leaseExpiresAt?: string;
    }>('describe', request);
    this.refs.clear();
    const generation = this.helper.generation();
    const nodes = raw.nodes.map((node) => {
      const ref = `ref_${generation}_${this.nextRefId++}`;
      this.refs.set(ref, node.handle);
      const { handle: _handle, ...rest } = node;
      return { ...rest, ref };
    });
    return {
      window: raw.window,
      nodes,
      truncated: raw.truncated,
      snapshotId: raw.snapshotId,
      windowLeaseId: raw.windowLeaseId,
      leaseExpiresAt: raw.leaseExpiresAt,
    };
  }

  capture(windowId?: string): Promise<DesktopCaptureResult> {
    return this.helper.call<DesktopCaptureResult>('capture', { windowId });
  }

  async act(request: ActRequest): Promise<ActResult> {
    let handle: string | undefined;
    if (request.ref) {
      handle = this.refs.get(request.ref);
      // A ref minted before a helper restart carries an older generation and is
      // simply absent here. Refusing is the whole point: falling back to
      // coordinates would click whatever now occupies those pixels.
      if (!handle) {
        throw new DesktopDriverError(
          'DESKTOP_REF_STALE',
          `Ref ${request.ref} is no longer live. Call desktop_describe again.`,
        );
      }
    }
    // Leading screenState: nothing has happened yet, so a failure here is a
    // plain rejection -- there is no action outcome that needs preserving.
    const before = await this.helper.call<ScreenState>('screenState', {});
    // The action itself: a failure here means it did not complete, so this
    // must also reject.
    const ok = await this.helper.call<boolean>('act', { ...request, handle });
    // Trailing screenState: the action has already happened for real. A
    // failure here must not throw the completed outcome away -- the caller
    // needs `ok`, and a conservative (all-true, marked) delta rather than an
    // exception that makes a landed click indistinguishable from one that
    // never fired.
    try {
      const after = await this.helper.call<ScreenState>('screenState', {});
      return { ok, delta: computeDelta(before, after) };
    } catch {
      return { ok, delta: makeUnreliableDelta() };
    }
  }

  async disconnect(): Promise<void> {
    this.refs.clear();
    await this.helper.kill();
  }

  targetIdentity(windowId: string): Promise<DesktopTargetIdentity> {
    return this.helper.call<DesktopTargetIdentity>('targetIdentity', { windowId });
  }

  async describeBackground(request: {
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
  }> {
    const raw = await this.helper.call<{
      window: DesktopWindowIdentity;
      windowInstance: DesktopWindowInstance;
      hostApplication?: DesktopTargetIdentity['hostApplication'];
      nodes: (Omit<DesktopNode, 'ref'> & { handle: string })[];
      truncated: boolean;
    }>('describeBackground', request);
    const generation = this.helper.generation();
    const nodes = raw.nodes.map((node) => {
      const ref = `ref_bg_${generation}_${this.nextRefId++}`;
      return { ...node, ref };
    });
    return { ...raw, nodes };
  }

  releaseBackgroundSnapshot(snapshotId: string): Promise<boolean> {
    return this.helper.call('releaseBackgroundSnapshot', { snapshotId });
  }

  backgroundAct(request: {
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
  }> {
    return this.helper.call('backgroundAct', request);
  }
}
