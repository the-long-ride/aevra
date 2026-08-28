export const EXPOSURE_PROVIDERS = ['local', 'direct', 'cloudflare', 'ngrok', 'external'] as const;

export type ExposureProvider = (typeof EXPOSURE_PROVIDERS)[number];
export type LocalProtocol = 'https' | 'http';

export interface ExposureConfig {
  provider: ExposureProvider;
  localProtocol?: LocalProtocol;
  publicUrl?: string;
  adminPublicUrl?: string;
  trustedAdminOrigins?: string[];
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
