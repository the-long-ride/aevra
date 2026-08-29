import type { SettingsRepository } from '../../../../packages/store/src/settings.js';
import { normalizeAdminPublicUrl, normalizeTrustedAdminOrigins } from './admin-origin.js';
import { EXPOSURE_PROVIDERS, type ExposureConfig, type LocalProtocol } from './types.js';

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

export function resolveLocalProtocol(config: Pick<ExposureConfig, 'localProtocol'>): LocalProtocol {
  const protocol = config.localProtocol ?? 'https';
  if (protocol !== 'https' && protocol !== 'http') {
    throw new Error('Local transport protocol must be https or http');
  }
  return protocol;
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
  if (
    cloudflare.authMode === 'access' &&
    (!cloudflare.issuer?.trim() || !cloudflare.audience?.trim())
  ) {
    throw new Error('Cloudflare Access issuer and audience are required');
  }
}

function adminFields(input: ExposureConfig) {
  const adminPublicUrl = normalizeAdminPublicUrl(input.adminPublicUrl);
  const trustedAdminOrigins = normalizeTrustedAdminOrigins(input.trustedAdminOrigins);
  return {
    ...(adminPublicUrl ? { adminPublicUrl } : {}),
    ...(trustedAdminOrigins.length ? { trustedAdminOrigins } : {}),
  };
}

function trustedProxyField(input: ExposureConfig) {
  return input.trustedProxyClientIp === true ? { trustedProxyClientIp: true as const } : {};
}

function localProtocolField(input: ExposureConfig) {
  return input.localProtocol ? { localProtocol: resolveLocalProtocol(input) } : {};
}

export function validateExposureConfig(input: ExposureConfig): ExposureConfig {
  if (!(EXPOSURE_PROVIDERS as readonly string[]).includes(input.provider)) {
    throw new Error(`Unsupported exposure provider: ${String(input.provider)}`);
  }

  const localProtocol = resolveLocalProtocol(input);
  const config: ExposureConfig = {
    ...input,
    publicUrl: normalizePublicUrl(input.publicUrl),
    ...adminFields(input),
    ...trustedProxyField(input),
  };
  if (config.trustedProxyClientIp !== true) delete config.trustedProxyClientIp;
  if (!config.publicUrl) delete config.publicUrl;
  if (!config.adminPublicUrl) delete config.adminPublicUrl;
  if (!config.trustedAdminOrigins?.length) delete config.trustedAdminOrigins;

  if (input.provider === 'local') {
    return {
      provider: 'local',
      ...localProtocolField(input),
      ...adminFields(config),
      ...trustedProxyField(input),
    };
  }

  if (input.provider === 'direct') {
    if (localProtocol !== 'https')
      throw new Error('Direct exposure requires HTTPS local transport');
    if (!config.publicUrl) throw new Error('Direct exposure requires a public URL');
    if (!input.direct?.host?.trim()) throw new Error('Direct exposure host is required');
    config.direct = { host: input.direct.host.trim() };
    return config;
  }

  if (input.provider === 'external') {
    if (!config.publicUrl) throw new Error('External exposure requires a public URL');
    return {
      provider: 'external',
      ...localProtocolField(input),
      publicUrl: config.publicUrl,
      ...adminFields(config),
      ...trustedProxyField(input),
    };
  }

  if (input.provider === 'cloudflare') {
    validateCloudflare(config);
    return config;
  }

  if (!input.ngrok || !['managed', 'external'].includes(input.ngrok.ownership)) {
    throw new Error('ngrok ownership must be managed or external');
  }
  const domainMode = input.ngrok.domainMode;
  if (domainMode && !['automatic', 'stable'].includes(domainMode)) {
    throw new Error('ngrok domain mode must be automatic or stable');
  }
  if (input.ngrok.ownership === 'external' && !config.publicUrl) {
    throw new Error('External ngrok exposure requires a public URL');
  }
  if (input.ngrok.ownership === 'managed' && domainMode === 'stable' && !config.publicUrl) {
    throw new Error('Managed ngrok stable domain requires a public URL');
  }
  config.ngrok = {
    ownership: input.ngrok.ownership,
    ...(domainMode ? { domainMode } : {}),
  };
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
