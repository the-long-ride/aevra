import type { OAuthRepository } from '../../../../packages/store/src/oauth.js';
import type { SettingsRepository } from '../../../../packages/store/src/settings.js';
import type { CoreConfig } from '../config.js';
import type { LocalTlsMaterial } from '../tls/local-tls.js';
import { normalizeAdminPublicUrl, normalizeTrustedAdminOrigins } from './admin-origin.js';
import { loadExposureConfig, resolveLocalProtocol } from './config.js';
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
import { validateRuntimeTransport } from './transport-validation.js';
import type { LocalProtocol } from './types.js';

const TUNNEL_WATCHDOG_INTERVAL_MS = 5_000;

export class RuntimeExposureWiring {
  readonly cloudflare: CloudflareManager;
  readonly oauth: AevraOAuthService;
  readonly verifier: RemoteIdentityVerifier;
  private readonly controller: RuntimeExposureController;
  private gateway?: PublicGateway;
  private watchdog?: TunnelWatchdog;
  private adminUrl?: string;
  private mcpUrl?: string;

  constructor(
    private readonly config: CoreConfig,
    settings: SettingsRepository,
    oauthRepo: OAuthRepository,
    private readonly tls: LocalTlsMaterial,
    cloudflareOverride?: CloudflareManager,
    private readonly gatewayTrustSecret?: string,
  ) {
    this.cloudflare = cloudflareOverride ?? new CloudflareManagerImpl(settings);
    const initialExposureConfig = loadExposureConfig(settings);
    const provisionalBase = `${resolveLocalProtocol(initialExposureConfig)}://localhost:${config.publicPort || 47830}`;
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

  localProtocol(): LocalProtocol {
    return resolveLocalProtocol(this.controller.currentConfig());
  }

  async startGateway(adminUrl: string, mcpUrl: string): Promise<void> {
    const protocol = this.localProtocol();
    this.adminUrl = adminUrl;
    this.mcpUrl = mcpUrl;
    this.gateway = new PublicGateway({
      host: this.controller.gatewayHost(),
      port: this.config.publicPort,
      protocol,
      ...(protocol === 'https' ? { tls: this.tls.serverOptions } : {}),
      targets: { adminUrl, mcpUrl },
      upstreamCa: this.tls.certificatePem,
      gatewayTrustSecret: this.gatewayTrustSecret,
      // Local-only keeps serving the Admin UI on the gateway as before. Once a
      // public exposure provider is active, Admin is reachable through the gateway
      // only if the operator deliberately published an adminPublicUrl.
      adminProxyEnabled: () =>
        this.controller.currentConfig().provider === 'local' || Boolean(this.adminPublicUrl()),
      trustForwardedClientIp: () => this.trustForwardedClientIp(),
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
    this.adminUrl = undefined;
    this.mcpUrl = undefined;
  }

  gatewayUrl(): string {
    return this.gateway?.url() ?? `${this.localProtocol()}://localhost:${this.config.publicPort}`;
  }

  publicUrl(): string | undefined {
    return this.controller.status().publicUrl;
  }

  adminPublicUrl(): string | undefined {
    return this.controller.currentConfig().adminPublicUrl ?? this.config.adminPublicUrl;
  }

  /**
   * True when the operator declared an upstream proxy that overwrites the client-IP
   * header. Without it those headers are client-controlled and must be ignored, which
   * collapses every client behind a proxy onto one rate-limit bucket.
   */
  trustForwardedClientIp(): boolean {
    return this.controller.currentConfig().trustedProxyClientIp === true;
  }

  trustedAdminOrigins(): string[] {
    const config = this.controller.currentConfig();
    return normalizeTrustedAdminOrigins([
      ...(this.adminPublicUrl() ? [this.adminPublicUrl()!] : []),
      ...(config.trustedAdminOrigins ?? []),
      ...(this.config.trustedAdminOrigins ?? []),
    ]);
  }

  transportValidation() {
    const status = this.controller.status();
    return validateRuntimeTransport({
      provider: this.controller.currentConfig().provider,
      gatewayUrl: this.gatewayUrl(),
      adminUrl: this.adminUrl ?? `https://localhost:${this.config.adminPort}`,
      mcpUrl: this.mcpUrl ?? `https://localhost:${this.config.mcpPort}`,
      ...(this.publicUrl() ? { publicUrl: this.publicUrl() } : {}),
      restartRequired: status.restartRequired,
    });
  }

  status() {
    return {
      ...this.controller.status(),
      ...(this.adminPublicUrl() ? { adminPublicUrl: this.adminPublicUrl() } : {}),
      trustedAdminOrigins: this.trustedAdminOrigins(),
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

  async testAdmin(candidate?: { publicUrl?: string; trustedOrigins?: string[] }) {
    const publicUrl = candidate
      ? normalizeAdminPublicUrl(candidate.publicUrl)
      : this.adminPublicUrl();
    if (!publicUrl) {
      return {
        configured: false,
        trusted: false,
        reachable: false,
        message: 'Admin public URL is not configured',
      };
    }
    const trustedOrigins = candidate
      ? normalizeTrustedAdminOrigins([
          publicUrl,
          ...(candidate.trustedOrigins ?? []),
          ...(this.config.trustedAdminOrigins ?? []),
        ])
      : this.trustedAdminOrigins();
    const trusted = trustedOrigins.includes(new URL(publicUrl).origin);
    const healthBase = new URL(publicUrl);
    if (!healthBase.pathname.endsWith('/')) healthBase.pathname += '/';
    try {
      const response = await fetch(new URL('api/health', healthBase), {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        return {
          configured: true,
          trusted,
          reachable: false,
          publicUrl,
          message: `Admin endpoint returned HTTP ${response.status}`,
        };
      }
      const body = (await response.json()) as { core?: unknown };
      if (body?.core !== 'running') {
        return {
          configured: true,
          trusted,
          reachable: false,
          publicUrl,
          message: 'Endpoint did not return Aevra Admin health',
        };
      }
      return { configured: true, trusted, reachable: true, publicUrl };
    } catch (error) {
      return {
        configured: true,
        trusted,
        reachable: false,
        publicUrl,
        message: error instanceof Error ? error.message : String(error),
      };
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
