import type { ExposureProvider } from './types.js';

export type RuntimeTransportProtocol = 'http' | 'https';

export interface RuntimeTransportEndpoint {
  url: string;
  protocol: RuntimeTransportProtocol;
  encrypted: boolean;
  loopback: boolean;
}

export interface RuntimePublicTransportEndpoint {
  url?: string;
  protocol: 'https' | null;
  encrypted: boolean | null;
}

export interface RuntimeTransportValidation {
  state: 'secure' | 'local-http' | 'action-required' | 'invalid';
  summary: string;
  gateway: RuntimeTransportEndpoint;
  admin: RuntimeTransportEndpoint;
  mcp: RuntimeTransportEndpoint;
  public: RuntimePublicTransportEndpoint;
  issues: string[];
}

function loopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

function localEndpoint(url: string): RuntimeTransportEndpoint {
  const parsed = new URL(url);
  const protocol: RuntimeTransportProtocol = parsed.protocol === 'http:' ? 'http' : 'https';
  return {
    url: parsed.toString().replace(/\/$/, ''),
    protocol,
    encrypted: protocol === 'https',
    loopback: loopback(parsed.hostname),
  };
}

export function validateRuntimeTransport(input: {
  provider?: ExposureProvider;
  gatewayUrl: string;
  adminUrl: string;
  mcpUrl: string;
  publicUrl?: string;
  restartRequired?: boolean;
}): RuntimeTransportValidation {
  const gateway = localEndpoint(input.gatewayUrl);
  const admin = localEndpoint(input.adminUrl);
  const mcp = localEndpoint(input.mcpUrl);
  const issues: string[] = [];

  if (input.provider !== 'direct' && !gateway.loopback) {
    issues.push('Local gateway must remain bound to loopback.');
  }
  if (input.provider === 'direct' && gateway.protocol !== 'https') {
    issues.push('Direct exposure requires an HTTPS gateway.');
  }
  if (!admin.loopback) issues.push('Admin must remain bound to loopback.');
  if (!mcp.loopback) issues.push('MCP ingress must remain bound to loopback.');
  if (admin.protocol !== 'https') issues.push('Admin must use HTTPS.');
  if (mcp.protocol !== 'https') issues.push('MCP ingress must use HTTPS.');

  let publicEndpoint: RuntimePublicTransportEndpoint = {
    protocol: null,
    encrypted: null,
  };
  if (input.publicUrl) {
    const parsed = new URL(input.publicUrl);
    const encrypted = parsed.protocol === 'https:';
    publicEndpoint = {
      url: parsed.toString().replace(/\/$/, ''),
      protocol: encrypted ? 'https' : null,
      encrypted,
    };
    if (input.provider !== 'local' && !encrypted) {
      issues.push('Public exposure must use HTTPS.');
    }
  }

  const state = issues.length
    ? 'invalid'
    : input.restartRequired
      ? 'action-required'
      : gateway.protocol === 'http'
        ? 'local-http'
        : 'secure';
  const summary =
    state === 'invalid'
      ? issues.join(' ')
      : state === 'action-required'
        ? 'Restart Aevra to apply the saved local gateway transport configuration.'
        : state === 'local-http'
          ? 'HTTP is limited to the loopback gateway; Admin and MCP remain HTTPS.'
          : input.provider === 'direct'
            ? 'Direct exposure and internal Admin and MCP transport are using HTTPS.'
            : 'Local gateway, Admin, and MCP are using HTTPS.';

  return {
    state,
    summary,
    gateway,
    admin,
    mcp,
    public: publicEndpoint,
    issues,
  };
}
