import type { OAuthRepository } from '../../../../packages/store/src/oauth.js';
import type { SettingsRepository } from '../../../../packages/store/src/settings.js';
import type { CoreConfig } from '../config.js';
import type { LocalTlsMaterial } from '../tls/local-tls.js';
import {
  CloudflareAccessVerifier,
  RejectingIdentityVerifier,
  type RemoteIdentityVerifier,
} from '../auth/cloudflare.js';
import { AevraOAuthService } from '../auth/oauth.js';
import { CloudflareManagerImpl, type CloudflareManager } from '../cloudflare/manager.js';
import { TunnelWatchdog, type TunnelHealth } from '../cloudflare/watchdog.js';
import { PublicGateway } from '../gateway/public-gateway.js';
import { ExposureService } from './service.js';
import { NgrokAdapter } from './ngrok.js';
import { RuntimeExposureController } from './runtime-controller.js';

const TUNNEL_WATCHDOG_INTERVAL_MS = 5_000;

export class RuntimeExposureWiring {
  readonly cloudflare: CloudflareManager;
  readonly oauth: AevraOAuthService;
  readonly verifier: RemoteIdentityVerifier;
  private readonly controller: RuntimeExposureController;
  private gateway?: PublicGateway;
  private watchdog?: TunnelWatchdog;

  constructor(
    private readonly config: CoreConfig,
    settings: SettingsRepository,
    oauthRepo: OAuthRepository,
    private readonly tls: LocalTlsMaterial,
    cloudflareOverride?: CloudflareManager,
  ) {
    this.cloudflare = cloudflareOverride ?? new CloudflareManagerImpl(settings);
    const provisionalBase = `https://localhost:${config.publicPort || 47830}`;
    this.oauth = new AevraOAuthService(oauthRepo, {
      issuer: provisionalBase,
      resource: `${provisionalBase}/mcp`,
      accessTokenTtlMs: config.oauthAccessTokenTtlMs,
      refreshTokenTtlMs: config.oauthRefreshTokenTtlMs,
    });
    const exposure = new ExposureService({
      cloudflare: this.cloudflare,
      ngrok: new NgrokAdapter(),
    });
    this.controller = new RuntimeExposureController(
      settings,
      exposure,
      this.oauth,
      {
        url: () => this.gateway?.url(),
        host: () => {
          const address = this.gateway?.address();
          return address && typeof address !== 'string' ? address.address : undefined;
        },
      },
      config.publicHost,
    );

    const exposureConfig = this.controller.currentConfig();
    if (exposureConfig.provider === 'direct' && tls.managed) {
      throw new Error(
        'Direct exposure requires trusted TLS from AEVRA_TLS_CERT and AEVRA_TLS_KEY; the managed localhost certificate cannot be exposed publicly',
      );
    }

    const cloudflare =
      exposureConfig.provider === 'cloudflare' ? exposureConfig.cloudflare : undefined;
    const issuer = process.env.AEVRA_CF_ISSUER ?? cloudflare?.issuer ?? '';
    const audience = process.env.AEVRA_CF_AUDIENCE ?? cloudflare?.audience ?? '';
    const accessReady =
      exposureConfig.provider === 'cloudflare' &&
      (cloudflare?.authMode === 'access' ||
        Boolean(process.env.AEVRA_CF_ISSUER && process.env.AEVRA_CF_AUDIENCE)) &&
      Boolean(issuer && audience);
    this.verifier = accessReady
      ? new CloudflareAccessVerifier(issuer, audience)
      : new RejectingIdentityVerifier();
  }

  async startGateway(adminUrl: string, mcpUrl: string): Promise<void> {
    this.gateway = new PublicGateway({
      host: this.controller.gatewayHost(),
      port: this.config.publicPort,
      tls: this.tls.serverOptions,
      targets: { adminUrl, mcpUrl },
      upstreamCa: this.tls.certificatePem,
    });
    await this.gateway.start();
  }

  async startProvider(): Promise<void> {
    const gatewayUrl = this.gateway?.url();
    if (!gatewayUrl) throw new Error('Public gateway is not running');
    try {
      await this.controller.start(gatewayUrl);
    } catch {
      // Managed provider failures stay visible in exposure status while local Aevra remains available.
    } finally {
      this.refreshWatchdog();
    }
  }

  async close(): Promise<void> {
    this.watchdog?.stop();
    this.watchdog = undefined;
    await this.controller.close();
    await this.gateway?.close();
    this.gateway = undefined;
  }

  gatewayUrl(): string {
    return this.gateway?.url() ?? `https://localhost:${this.config.publicPort}`;
  }

  publicUrl(): string | undefined {
    return this.controller.status().publicUrl;
  }

  status() {
    return {
      ...this.controller.status(),
      tunnelHealth: this.watchdog?.status ?? { reachable: null, checkedAt: null, message: null },
    };
  }

  async configure(input: Parameters<RuntimeExposureController['configure']>[0]) {
    try {
      return await this.controller.configure(input);
    } finally {
      this.refreshWatchdog();
    }
  }

  async test() {
    const status = this.controller.status();
    if (status.provider === 'local') return this.controller.test();
    const health = this.watchdog ? await this.watchdog.checkNow() : await this.probeReachability();
    return {
      provider: status.provider,
      reachable: health.reachable === true,
      state: health.reachable === true ? 'ready' : 'error',
      ...(status.publicUrl ? { publicUrl: status.publicUrl } : {}),
      ...(health.message ? { message: health.message } : {}),
    };
  }

  currentConfig() {
    return this.controller.currentConfig();
  }

  private refreshWatchdog(): void {
    this.watchdog?.stop();
    this.watchdog = undefined;

    const config = this.controller.currentConfig();
    if (config.provider === 'local') return;

    this.watchdog = new TunnelWatchdog(
      () => this.probeReachability(),
      TUNNEL_WATCHDOG_INTERVAL_MS,
    ).start();
  }

  private async probeReachability(): Promise<{ reachable: boolean; message: string }> {
    const config = this.controller.currentConfig();
    if (config.provider === 'cloudflare') {
      const result = await this.cloudflare.checkReachability();
      return { reachable: result.reachable, message: result.message ?? '' };
    }

    const publicUrl = this.controller.status().publicUrl;
    if (!publicUrl) return { reachable: false, message: 'Public URL is not configured' };
    try {
      const response = await fetch(`${publicUrl.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return {
        reachable: response.ok,
        message: response.ok ? '' : `Upstream responded with HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        reachable: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export type { TunnelHealth };
