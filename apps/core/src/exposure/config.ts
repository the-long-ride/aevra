import type { SettingsRepository } from '../../../../packages/store/src/settings.js';
import { EXPOSURE_PROVIDERS, type ExposureConfig } from './types.js';

type SettingsLike = Pick<SettingsRepository, 'get' | 'set'>;

function normalizePublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Exposure public URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') throw new Error('Exposure public URL must use HTTPS');
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function validateCloudflare(config: ExposureConfig) {
  const cloudflare = config.cloudflare;
  if (!cloudflare) throw new Error('Cloudflare exposure configuration is required');
  if (!['managed', 'external'].includes(cloudflare.ownership)) {
    throw new Error('Cloudflare ownership must be managed or external');
  }
  if (!['oauth', 'access'].includes(cloudflare.authMode)) {
    throw new Error('Cloudflare auth mode must be oauth or access');
  }
  if (cloudflare.authMode === 'access' && (!cloudflare.issuer?.trim() || !cloudflare.audience?.trim())) {
    throw new Error('Cloudflare Access issuer and audience are required');
  }
}

export function validateExposureConfig(input: ExposureConfig): ExposureConfig {
  if (!(EXPOSURE_PROVIDERS as readonly string[]).includes(input.provider)) {
    throw new Error(`Unsupported exposure provider: ${String(input.provider)}`);
  }

  const config: ExposureConfig = {
    ...input,
    publicUrl: normalizePublicUrl(input.publicUrl),
  };

  if (input.provider === 'local') {
    return { provider: 'local' };
  }

  if (input.provider === 'direct') {
    if (!config.publicUrl) throw new Error('Direct exposure requires a public URL');
    if (!input.direct?.host?.trim()) throw new Error('Direct exposure host is required');
    config.direct = { host: input.direct.host.trim() };
    return config;
  }

  if (input.provider === 'external') {
    if (!config.publicUrl) throw new Error('External exposure requires a public URL');
    return { provider: 'external', publicUrl: config.publicUrl };
  }

  if (input.provider === 'cloudflare') {
    validateCloudflare(config);
    return config;
  }

  if (!input.ngrok || !['managed', 'external'].includes(input.ngrok.ownership)) {
    throw new Error('ngrok ownership must be managed or external');
  }
  if (input.ngrok.ownership === 'external' && !config.publicUrl) {
    throw new Error('External ngrok exposure requires a public URL');
  }
  return config;
}

function migrateLegacyCloudflare(settings: SettingsLike, legacy: any): ExposureConfig {
  const hostname = typeof legacy.hostname === 'string' ? legacy.hostname.trim() : '';
  const ownership = legacy.ownership === 'external' ? 'external' : 'managed';
  const authMode = legacy.authMode === 'access' ? 'access' : 'oauth';
  const cloudflare: NonNullable<ExposureConfig['cloudflare']> = {
    ownership,
    authMode,
    ...(legacy.tunnelId ? { tunnelId: String(legacy.tunnelId) } : {}),
    ...(hostname ? { hostname } : {}),
    ...(authMode === 'access' && legacy.issuer ? { issuer: String(legacy.issuer) } : {}),
    ...(authMode === 'access' && legacy.audience ? { audience: String(legacy.audience) } : {}),
  };
  const migrated = validateExposureConfig({
    provider: 'cloudflare',
    ...(hostname ? { publicUrl: `https://${hostname}` } : {}),
    cloudflare,
  });
  settings.set('exposure.config', migrated);
  return migrated;
}

export function loadExposureConfig(settings: SettingsLike): ExposureConfig {
  const existing = settings.get<ExposureConfig | null>('exposure.config', null);
  if (existing) return validateExposureConfig(existing);

  const legacy = settings.get<any>('cloudflare.config', null);
  if (legacy) return migrateLegacyCloudflare(settings, legacy);

  return { provider: 'local' };
}
