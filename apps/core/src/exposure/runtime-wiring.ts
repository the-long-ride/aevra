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
import { PublicGateway } from '../gateway/public-gateway.js';
import { ExposureService } from './service.js';
import { NgrokAdapter } from './ngrok.js';
import { RuntimeExposureController } from './runtime-controller.js';

export class RuntimeExposureWiring {
  readonly cloudflare: CloudflareManager;
  readonly oauth: AevraOAuthService;
  readonly verifier: RemoteIdentityVerifier;
  private readonly controller: RuntimeExposureController;
  private gateway?: PublicGateway;

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

    const cloudflare = exposureConfig.provider === 'cloudflare' ? exposureConfig.cloudflare : undefined;
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
    }
  }

  async close(): Promise<void> {
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
    return this.controller.status();
  }

  configure(input: Parameters<RuntimeExposureController['configure']>[0]) {
    return this.controller.configure(input);
  }

  test() {
    return this.controller.test();
  }

  currentConfig() {
    return this.controller.currentConfig();
  }
}
