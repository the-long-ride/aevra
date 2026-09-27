import { CdpDriver } from '../../../packages/browser/src/cdp-driver.js';
import type { BrowserDriver, ConnectOptions } from '../../../packages/browser/src/driver.js';
import { ExtensionDriver } from '../../../packages/browser/src/extension-driver.js';
import { ExtensionServer } from '../../../packages/browser/src/extension-server.js';
import { BrowserSessionRegistry } from '../../../packages/browser/src/registry.js';
import type {
  BrowserExtensionPairing,
  BrowserListenerHealth,
} from '../../../packages/protocol/src/browser.js';

export interface BrowserRuntimeConfig {
  browserTokenKey: Buffer;
  extensionPort?: number;
  createDriver?: (options: ConnectOptions) => Promise<BrowserDriver>;
}

const DEFAULT_PORT = Number(process.env.AEVRA_BROWSER_PORT ?? 47833);

function failedListener(error: unknown, port: number): BrowserListenerHealth {
  const code = String((error as { code?: string }).code ?? 'BROWSER_LISTENER_FAILED');
  return {
    state: 'failed',
    port,
    errorCode: ['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL'].includes(code)
      ? code
      : 'BROWSER_LISTENER_FAILED',
    changedAt: new Date().toISOString(),
  };
}

/**
 * Worker-side owner of every live browser socket, held as a module singleton
 * the way `processRuntime` is. Core synchronizes the epoch and complete pairing
 * registry before the listener accepts extension authentication. Keeping the
 * listener available with an empty registry lets revoked extensions learn that
 * they must pair again instead of retrying forever against a closed port.
 */
class BrowserRuntime {
  private config: BrowserRuntimeConfig | null = null;
  private server: ExtensionServer | null = null;
  private allowedPairings: BrowserExtensionPairing[] = [];
  private pairedExtensionId: string | null = null;
  private listener: BrowserListenerHealth = {
    state: 'stopped',
    port: DEFAULT_PORT,
    errorCode: null,
    changedAt: new Date().toISOString(),
  };
  private sessions = new BrowserSessionRegistry({
    createDriver: (options) => this.createDriver(options),
    extensionPaired: () => Boolean(this.server?.peer()),
    teardownExtension: () => this.stopServer(),
  });

  configure(config: BrowserRuntimeConfig): void {
    this.config = config;
    if (config) this.listener = { ...this.listener, port: config.extensionPort ?? DEFAULT_PORT };
  }

  registry(): BrowserSessionRegistry {
    return this.sessions;
  }

  listenerHealth(): BrowserListenerHealth {
    return { ...this.listener };
  }

  extensionSocketAuthenticated(): boolean {
    return Boolean(this.server?.peer());
  }

  extensionId(): string | null {
    return this.pairedExtensionId;
  }

  activeProfile() {
    return this.server?.activeProfile() ?? null;
  }

  /**
   * Replace the worker's complete authorized profile set. The extension
   * listener reads this live array for every new authentication attempt.
   */
  async setPairings(pairings: BrowserExtensionPairing[]): Promise<void> {
    const next = pairings.map((pairing) => ({ ...pairing }));
    const activeStillAllowed = this.server?.activePairingStillAllowed(next) ?? true;
    this.allowedPairings = next;
    this.pairedExtensionId = next.at(-1)?.extensionId ?? null;
    this.server?.pruneStandby(next);

    if (!activeStillAllowed) {
      if (this.sessions.transport() === 'extension') await this.sessions.disconnect();
      this.server?.rejectPeer();
    }

    if (this.config && !this.config.createDriver) {
      try {
        await this.extensionServer(this.config);
      } catch (error) {
        this.listener = failedListener(error, this.config.extensionPort ?? DEFAULT_PORT);
      }
    }
  }

  /**
   * Compatibility adapter for old one-extension worker envelopes.
   */
  async setExtensionId(extensionId: string): Promise<void> {
    await this.setPairings(
      extensionId
        ? [
            {
              pairingId: `legacy-${extensionId}`,
              profileId: null,
              profileName: 'Legacy browser profile',
              extensionId,
              credentialId: null,
              legacy: true,
            },
          ]
        : [],
    );
  }

  private required(): BrowserRuntimeConfig {
    if (!this.config) {
      throw Object.assign(new Error('Browser control is not configured on this worker'), {
        code: 'BROWSER_UNAVAILABLE',
      });
    }
    return this.config;
  }

  private async createDriver(options: ConnectOptions): Promise<BrowserDriver> {
    const config = this.required();
    if (config.createDriver) return config.createDriver(options);
    if (options.transport === 'cdp') return new CdpDriver();
    return new ExtensionDriver(await this.extensionServer(config));
  }

  private async extensionServer(config: BrowserRuntimeConfig): Promise<ExtensionServer> {
    if (this.server) return this.server;
    const server = new ExtensionServer({
      secret: config.browserTokenKey,
      extensionId: this.pairedExtensionId ?? undefined,
      pairings: () => this.allowedPairings,
      epoch: () => this.sessions.epoch(),
    });
    try {
      const address = await server.start({ port: config.extensionPort ?? DEFAULT_PORT });
      this.server = server;
      this.listener = {
        state: 'listening',
        port: address.port,
        errorCode: null,
        changedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.listener = failedListener(error, config.extensionPort ?? DEFAULT_PORT);
      throw error;
    }
    return server;
  }

  private async stopServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.listener = {
      state: 'stopped',
      port: this.config?.extensionPort ?? DEFAULT_PORT,
      errorCode: null,
      changedAt: new Date().toISOString(),
    };
    if (server) await server.stop();
  }

  async shutdown(): Promise<void> {
    await this.sessions.disconnect();
    await this.stopServer();
  }
}

export const browserRuntime = new BrowserRuntime();
