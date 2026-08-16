import { validateExposureConfig } from './config.js';
import type { ExposureAdapter, ExposureConfig, ExposureProvider, ExposureStatus } from './types.js';

type ManagedProvider = 'cloudflare' | 'ngrok';

export class ExposureService {
  private current: ExposureStatus = { provider: 'local', state: 'stopped' };
  private activeAdapter?: ExposureAdapter;

  constructor(private readonly adapters: Partial<Record<ManagedProvider, ExposureAdapter>> = {}) {}

  async start(configInput: ExposureConfig, localGatewayUrl: string): Promise<ExposureStatus> {
    const config = validateExposureConfig(configInput);
    await this.stopActiveAdapter();

    if (config.provider === 'local') {
      return this.setReady('local', localGatewayUrl, localGatewayUrl);
    }
    if (config.provider === 'direct' || config.provider === 'external') {
      return this.setReady(config.provider, localGatewayUrl, config.publicUrl!);
    }
    if (config.provider === 'cloudflare' && config.cloudflare?.ownership === 'external') {
      const publicUrl = config.publicUrl ?? this.cloudflareUrl(config);
      if (!publicUrl) throw new Error('Cloudflare public URL is unavailable');
      return this.setReady('cloudflare', localGatewayUrl, publicUrl);
    }
    if (config.provider === 'ngrok' && config.ngrok?.ownership === 'external') {
      return this.setReady('ngrok', localGatewayUrl, config.publicUrl!);
    }

    const adapter = this.adapters[config.provider as ManagedProvider];
    if (!adapter) {
      const error = new Error(`${config.provider} exposure adapter is unavailable`);
      this.setError(config.provider, localGatewayUrl, error);
      throw error;
    }

    try {
      const started = await adapter.start(localGatewayUrl);
      const publicUrl =
        started.publicUrl ??
        config.publicUrl ??
        (config.provider === 'cloudflare' ? this.cloudflareUrl(config) : undefined);
      if (!publicUrl) throw new Error(`${config.provider} public URL is unavailable`);
      this.activeAdapter = adapter;
      return this.setReady(config.provider, localGatewayUrl, publicUrl);
    } catch (error) {
      this.activeAdapter = undefined;
      this.setError(config.provider, localGatewayUrl, error);
      throw error;
    }
  }

  effectivePublicUrl(): string {
    if (!this.current.publicUrl) throw new Error('Exposure public URL is unavailable');
    return this.current.publicUrl;
  }

  status(): ExposureStatus {
    return { ...this.current };
  }

  async close(): Promise<void> {
    await this.stopActiveAdapter();
    this.current = { provider: this.current.provider, state: 'stopped' };
  }

  private async stopActiveAdapter() {
    const adapter = this.activeAdapter;
    this.activeAdapter = undefined;
    if (adapter) await adapter.stop();
  }

  private setReady(provider: ExposureProvider, localGatewayUrl: string, publicUrl: string) {
    this.current = { provider, state: 'ready', localGatewayUrl, publicUrl };
    return this.status();
  }

  private setError(provider: ExposureProvider, localGatewayUrl: string, error: unknown) {
    this.current = {
      provider,
      state: 'error',
      localGatewayUrl,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  private cloudflareUrl(config: ExposureConfig) {
    const hostname = config.cloudflare?.hostname?.trim();
    return hostname ? `https://${hostname}` : undefined;
  }
}
