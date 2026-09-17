import type {
  BrowserActionInput,
  BrowserActionResult,
  BrowserLogEntry,
  BrowserSessionInfo,
  BrowserSnapshotResult,
  BrowserTabInfo,
  BrowserTransport,
} from '../../protocol/src/browser.js';
import type { ExtensionServer } from './extension-server.js';
import {
  actTimeoutMs,
  BrowserDriverError,
  type ActOptions,
  type BrowserDriver,
  type ConnectOptions,
  type LogsRequest,
  type NavigateRequest,
  type NavigateResult,
  type ReadRequest,
  type ReadResult,
  type SnapshotRequest,
  type TabRequest,
} from './driver.js';

/**
 * `BrowserDriver` over the paired extension socket. It holds no browser logic
 * of its own: every method is one RPC, so the extension and the CDP transport
 * answer the same conformance suite.
 */
export class ExtensionDriver implements BrowserDriver {
  readonly transport: BrowserTransport = 'extension';
  private connected = false;

  constructor(private readonly server: ExtensionServer) {}

  private async call<T>(
    op: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    if (!this.connected) {
      throw new BrowserDriverError('BROWSER_NOT_CONNECTED', 'No extension session is connected');
    }
    if (!this.server.peer()) {
      throw new BrowserDriverError('BROWSER_UNAVAILABLE', 'The Aevra extension is not paired');
    }
    return (
      timeoutMs === undefined
        ? this.server.call(op, params)
        : this.server.call(op, params, timeoutMs)
    ) as Promise<T>;
  }

  async connect(options: ConnectOptions): Promise<BrowserSessionInfo> {
    if (!this.server.peer()) {
      throw new BrowserDriverError('BROWSER_UNAVAILABLE', 'The Aevra extension is not paired');
    }
    this.connected = true;
    return {
      sessionId: this.server.peerId(),
      transport: options.transport,
      connected: true,
      tabs: await this.tabs({ action: 'list' }),
    };
  }

  tabs(request: TabRequest): Promise<BrowserTabInfo[]> {
    return this.call('tabs', { ...request });
  }

  navigate(request: NavigateRequest): Promise<NavigateResult> {
    return this.call('navigate', { ...request });
  }

  snapshot(request: SnapshotRequest): Promise<BrowserSnapshotResult> {
    return this.call('snapshot', { ...request });
  }

  read(request: ReadRequest): Promise<ReadResult> {
    return this.call('read', { ...request });
  }

  /**
   * The socket budget follows the batch. A `wait_for` longer than the default
   * used to time out here while the same call succeeded over CDP.
   */
  act(actions: BrowserActionInput[], options: ActOptions): Promise<BrowserActionResult[]> {
    return this.call('act', { actions, ...options }, actTimeoutMs(actions));
  }

  logs(request: LogsRequest): Promise<BrowserLogEntry[]> {
    return this.call('logs', { ...request });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
