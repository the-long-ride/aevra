export const EXPOSURE_PROVIDERS = ['local', 'direct', 'cloudflare', 'ngrok', 'external'] as const;

export type ExposureProvider = (typeof EXPOSURE_PROVIDERS)[number];
export type LocalProtocol = 'https' | 'http';

export interface ExposureConfig {
  provider: ExposureProvider;
  localProtocol?: LocalProtocol;
  publicUrl?: string;
  adminPublicUrl?: string;
  trustedAdminOrigins?: string[];
  /**
   * Declares that a trusted reverse proxy in front of Aevra overwrites the client-IP
   * header, so `cf-connecting-ip` / `true-client-ip` / `x-real-ip` may be believed.
   * Off by default: without a declared proxy those headers are client-controlled, and
   * rate limiting and the audit trail key on the address they carry.
   */
  trustedProxyClientIp?: boolean;
  direct?: {
    host: string;
  };
  cloudflare?: {
    tunnelId?: string;
    hostname?: string;
    ownership: 'managed' | 'external';
    authMode: 'oauth' | 'access';
    issuer?: string;
    audience?: string;
  };
  ngrok?: {
    ownership: 'managed' | 'external';
    domainMode?: 'automatic' | 'stable';
  };
}

export interface ExposureAdapter {
  start(localGatewayUrl: string, requestedPublicUrl?: string): Promise<{ publicUrl?: string }>;
  stop(): Promise<void>;
  status(): Promise<{ state: string; message?: string }>;
}

export interface ExposureStatus {
  provider: ExposureProvider;
  state: 'stopped' | 'ready' | 'error';
  localGatewayUrl?: string;
  publicUrl?: string;
  adminPublicUrl?: string;
  trustedAdminOrigins?: string[];
  message?: string;
}
