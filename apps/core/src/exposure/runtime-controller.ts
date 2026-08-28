import type { SettingsRepository } from '../../../../packages/store/src/settings.js';
import type { AevraOAuthService } from '../auth/oauth.js';
import { loadExposureConfig, resolveLocalProtocol, validateExposureConfig } from './config.js';
import type { ExposureConfig } from './types.js';
import type { ExposureService } from './service.js';

interface GatewayState {
  url(): string | undefined;
  host(): string | undefined;
}

export class RuntimeExposureController {
  private config: ExposureConfig;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly exposure: ExposureService,
    private readonly oauth: AevraOAuthService,
    private readonly gateway: GatewayState,
    private readonly defaultHost = '127.0.0.1',
  ) {
    this.config = loadExposureConfig(settings);
  }

  gatewayHost(): string {
    if (this.config.provider === 'direct') {
      return this.config.direct?.host?.trim() || '0.0.0.0';
    }
    return this.defaultHost;
  }

  currentConfig(): ExposureConfig {
    return this.config;
  }

  restartRequired(): boolean {
    const gatewayUrl = this.gateway.url();
    if (!gatewayUrl) return false;
    const currentHost = this.gateway.host();
    const currentProtocol = new URL(gatewayUrl).protocol.replace(':', '');
    return Boolean(
      (currentHost && currentHost !== this.gatewayHost()) ||
      currentProtocol !== resolveLocalProtocol(this.config),
    );
  }

  async start(localGatewayUrl: string) {
    await this.exposure.start(this.config, localGatewayUrl);
    this.oauth.setPublicBaseUrl(this.exposure.effectivePublicUrl());
    return this.status();
  }

  status() {
    return {
      ...this.exposure.status(),
      config: this.config,
      restartRequired: this.restartRequired(),
      oauth: {
        issuer: this.oauth.issuer,
        resource: this.oauth.resource,
      },
    };
  }

  async configure(input: ExposureConfig) {
    const next = validateExposureConfig(input);
    this.settings.set('exposure.config', next);
    this.syncCloudflareCompatibility(next);
    this.config = next;

    const gatewayUrl = this.gateway.url();
    const restartRequired = !gatewayUrl || this.restartRequired();
    if (!gatewayUrl || restartRequired) {
      return {
        config: next,
        status: { ...this.status(), restartRequired: true },
      };
    }

    await this.start(gatewayUrl);
    return {
      config: next,
      status: { ...this.status(), restartRequired: false },
    };
  }

  async test() {
    const status = this.status();
    return {
      provider: status.provider,
      reachable: status.state === 'ready',
      state: status.state,
      ...(status.publicUrl ? { publicUrl: status.publicUrl } : {}),
      ...(status.message ? { message: status.message } : {}),
    };
  }

  close() {
    return this.exposure.close();
  }

  private syncCloudflareCompatibility(config: ExposureConfig) {
    if (config.provider !== 'cloudflare' || !config.cloudflare) return;
    const cloudflare = config.cloudflare;
    const legacy = {
      ...cloudflare,
      authMode: cloudflare.authMode === 'access' ? 'access' : 'connector',
      ...(cloudflare.hostname
        ? { hostname: cloudflare.hostname }
        : config.publicUrl
          ? { hostname: new URL(config.publicUrl).hostname }
          : {}),
    };
    this.settings.set('cloudflare.config', legacy);
    this.settings.set('cloudflare.ownership', cloudflare.ownership);
    this.settings.set(
      'cloudflare.issuer',
      cloudflare.authMode === 'access' ? (cloudflare.issuer ?? '') : '',
    );
    this.settings.set(
      'cloudflare.audience',
      cloudflare.authMode === 'access' ? (cloudflare.audience ?? '') : '',
    );
  }
}
