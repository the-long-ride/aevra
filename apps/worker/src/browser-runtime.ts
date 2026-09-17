import { CdpDriver } from '../../../packages/browser/src/cdp-driver.js';
import type { BrowserDriver, ConnectOptions } from '../../../packages/browser/src/driver.js';
import { ExtensionDriver } from '../../../packages/browser/src/extension-driver.js';
import { ExtensionServer } from '../../../packages/browser/src/extension-server.js';
import { BrowserSessionRegistry } from '../../../packages/browser/src/registry.js';
import { deriveBrowserTokenKey } from '../../../packages/security/src/browser-token-key.js';

export interface BrowserRuntimeConfig {
  secret: Buffer;
  extensionPort?: number;
  createDriver?: (options: ConnectOptions) => Promise<BrowserDriver>;
}

const DEFAULT_PORT = Number(process.env.AEVRA_BROWSER_PORT ?? 47833);

/**
 * Worker-side owner of every live browser socket, held as a module singleton
 * the way `processRuntime` is. The extension listener is created lazily on the
 * first connect, which is also the first envelope that can carry the epoch and
 * the paired extension id - so no socket is accepted before the worker knows
 * both.
 */
class BrowserRuntime {
  private config: BrowserRuntimeConfig | null = null;
  private server: ExtensionServer | null = null;
  private pairedExtensionId: string | null = null;
  private sessions = new BrowserSessionRegistry({
    createDriver: (options) => this.createDriver(options),
    extensionPaired: () => Boolean(this.server?.peer()),
    teardownExtension: () => this.stopServer(),
  });

  configure(config: BrowserRuntimeConfig): void {
    this.config = config;
  }

  registry(): BrowserSessionRegistry {
    return this.sessions;
  }

  extensionId(): string | null {
    return this.pairedExtensionId;
  }

  /**
   * A change of paired extension invalidates the origin pin the running
   * listener was built with, so the listener is dropped and rebuilt.
   */
  async setExtensionId(extensionId: string): Promise<void> {
    if (this.pairedExtensionId === extensionId) return;
    this.pairedExtensionId = extensionId;
    await this.stopServer();
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
    if (!this.pairedExtensionId) {
      throw Object.assign(new Error('No Aevra extension is paired'), {
        code: 'BROWSER_UNAVAILABLE',
      });
    }
    const server = new ExtensionServer({
      secret: deriveBrowserTokenKey(config.secret),
      extensionId: this.pairedExtensionId,
      epoch: () => this.sessions.epoch(),
    });
    await server.start({ port: config.extensionPort ?? DEFAULT_PORT });
    this.server = server;
    return server;
  }

  private async stopServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await server.stop();
  }

  async shutdown(): Promise<void> {
    await this.sessions.disconnect();
    await this.stopServer();
  }
}

export const browserRuntime = new BrowserRuntime();
