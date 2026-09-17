import type { DesktopCapabilities } from '../../protocol/src/desktop.js';
import { DesktopDriverError, type DesktopDriver } from './driver.js';

export interface DesktopRegistryDeps {
  createDriver(): Promise<DesktopDriver>;
}

export interface DesktopRegistryStatus {
  connected: boolean;
  capabilities: DesktopCapabilities | null;
}

/**
 * Owns the single live desktop session. There is one cursor and one focused
 * window on the machine, so - unlike the browser registry - there is no epoch
 * and no extension pairing to track, only "is a driver attached right now".
 */
export class DesktopSessionRegistry {
  private driver: DesktopDriver | null = null;
  private capabilities: DesktopCapabilities | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: DesktopRegistryDeps) {}

  async connect(): Promise<DesktopCapabilities> {
    await this.disconnect();
    const driver = await this.deps.createDriver();
    const capabilities = await driver.connect();
    this.driver = driver;
    this.capabilities = capabilities;
    return capabilities;
  }

  require(): DesktopDriver {
    if (!this.driver) {
      throw new DesktopDriverError(
        'DESKTOP_NOT_CONNECTED',
        'No desktop session is connected. Call desktop_connect first.',
      );
    }
    return this.driver;
  }

  /**
   * One action at a time. There is a single cursor and a single focused window;
   * two actions landing at once produce clicks that nobody chose.
   *
   * Connect, disconnect, and status stay outside the queue so the kill switch
   * reaches a wedged session instead of waiting behind it.
   */
  run<T>(operation: (driver: DesktopDriver) => Promise<T>): Promise<T> {
    const next = this.queue.then(() => operation(this.require()));
    // The chain must survive a rejected operation, otherwise one failure would
    // poison every later one queued behind it.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  status(): DesktopRegistryStatus {
    return { connected: Boolean(this.driver), capabilities: this.capabilities };
  }

  async disconnect(): Promise<void> {
    const driver = this.driver;
    this.driver = null;
    this.capabilities = null;
    if (!driver) return;
    try {
      await driver.disconnect();
    } catch {
      // Teardown is unconditional: a driver that cannot close cleanly is still gone.
    }
  }
}
