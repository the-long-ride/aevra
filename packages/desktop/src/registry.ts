import type { DesktopCapabilities } from '../../protocol/src/desktop.js';
import { BackgroundDesktopState } from './background-state.js';
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
 * window on the machine, serialized through the global queue.
 */
export class DesktopSessionRegistry {
  private driver: DesktopDriver | null = null;
  private capabilities: DesktopCapabilities | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private epochValue = 1;
  readonly backgroundState = new BackgroundDesktopState();

  constructor(private readonly deps: DesktopRegistryDeps) {}

  epoch(): number {
    return this.epochValue;
  }

  async connect(): Promise<DesktopCapabilities> {
    await this.disconnect();
    this.epochValue++;
    this.backgroundState.reset();
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
  run<T>(operation: (driver: DesktopDriver, epoch: number) => Promise<T>): Promise<T> {
    const enqueuedEpoch = this.epochValue;
    const next = this.queue.then(() => {
      if (this.epochValue !== enqueuedEpoch || !this.driver) {
        throw new DesktopDriverError(
          'DESKTOP_NOT_CONNECTED',
          'Desktop session epoch changed or disconnected while queued',
        );
      }
      return operation(this.require(), enqueuedEpoch);
    });
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
    this.epochValue++;
    this.backgroundState.reset();
    if (!driver) return;
    try {
      await driver.disconnect();
    } catch {
      // Teardown is unconditional: a driver that cannot close cleanly is still gone.
    }
  }
}
