import type {
  BrowserSessionInfo,
  BrowserTabInfo,
  BrowserTransport,
} from '../../protocol/src/browser.js';
import { BrowserDriverError, type BrowserDriver, type ConnectOptions } from './driver.js';

export interface RegistryStatus {
  connected: boolean;
  transport: BrowserTransport | null;
  epoch: number;
  extensionPaired: boolean;
  tabs: BrowserTabInfo[];
}

export interface BrowserRegistryDeps {
  createDriver(options: ConnectOptions): Promise<BrowserDriver>;
  extensionPaired(): boolean;
  teardownExtension(): Promise<void>;
}

/**
 * Owns the single live browser session and the extension epoch. Everything that
 * tears a session down - a second connect, an explicit disconnect, the web UI
 * kill switch - funnels through here, so there is one place where "is a browser
 * attached right now" is answered.
 */
export class BrowserSessionRegistry {
  private driver: BrowserDriver | null = null;
  private info: BrowserSessionInfo | null = null;
  /** null until core tells this worker which epoch it is on. */
  private epochValue: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BrowserRegistryDeps) {}

  epoch(): number {
    return this.epochValue ?? 0;
  }

  initialised(): boolean {
    return this.epochValue !== null;
  }

  /**
   * Initialisation and monotonicity are separate rules.
   *
   * A fresh worker has no epoch of its own. Starting it at 0 left it below
   * core's persisted epoch, which starts at 1, so every extension socket was
   * refused until a connect happened to sync it. An uninitialised registry
   * therefore adopts the first epoch an envelope carries, and adoption tears
   * nothing down because nothing was ever issued at the old value.
   *
   * Once set, the monotonic guard is unchanged: a late or replayed push
   * carrying an older epoch must never widen the set of tokens that verify.
   */
  async setEpoch(next: number): Promise<void> {
    if (!Number.isInteger(next)) return;
    if (this.epochValue === null) {
      this.epochValue = next;
      return;
    }
    if (next <= this.epochValue) return;
    this.epochValue = next;
    await this.disconnect();
    await this.deps.teardownExtension();
  }

  async connect(options: ConnectOptions): Promise<BrowserSessionInfo> {
    await this.disconnect();
    const driver = await this.deps.createDriver(options);
    const info = await driver.connect(options);
    this.driver = driver;
    this.info = info;
    return info;
  }

  require(): BrowserDriver {
    if (!this.driver) {
      throw new BrowserDriverError(
        'BROWSER_NOT_CONNECTED',
        'No browser session is connected. Call browser_connect first.',
      );
    }
    return this.driver;
  }

  /**
   * Runs one page operation with the session held exclusively. A browser tab is
   * shared mutable state with no transactions: two `act` batches landing at once
   * interleave their clicks, and a snapshot taken between another batch's steps
   * hands back refs for a page that is already moving. Files and commands are
   * serialized by the workspace lock coordinator; this is the browser's.
   *
   * Connect, disconnect, and status deliberately stay outside the queue. The
   * kill switch has to reach a wedged session, not wait behind it.
   */
  run<T>(operation: (driver: BrowserDriver) => Promise<T>): Promise<T> {
    const next = this.queue.then(() => operation(this.require()));
    // The chain must survive a rejected operation, otherwise one failure would
    // poison every later one queued behind it.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async status(): Promise<RegistryStatus> {
    const base = {
      epoch: this.epoch(),
      extensionPaired: this.deps.extensionPaired(),
    };
    if (!this.driver) {
      return { ...base, connected: false, transport: null, tabs: [] };
    }
    let tabs = this.info?.tabs ?? [];
    try {
      tabs = await this.driver.tabs({ action: 'list' });
    } catch {
      // A live refresh is best effort; a wedged socket must not make status unusable.
    }
    return { ...base, connected: true, transport: this.driver.transport, tabs };
  }

  async disconnect(): Promise<void> {
    const driver = this.driver;
    this.driver = null;
    this.info = null;
    if (!driver) return;
    try {
      await driver.disconnect();
    } catch {
      // Teardown is unconditional: a driver that cannot close cleanly is still gone.
    }
  }
}
