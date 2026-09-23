/** Public naming for entries proxied from a registered upstream MCP server. */
export const UPSTREAM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PROXY_SEPARATOR = '__';
const PROXY_URI_PREFIX = 'mcp+';

export interface ProxyRef {
  server: string;
  entry: string;
}

export function isUpstreamName(value: string): boolean {
  return UPSTREAM_NAME_PATTERN.test(value);
}

export function proxyName(server: string, entry: string): string {
  return `${server}${PROXY_SEPARATOR}${entry}`;
}

export function splitProxyName(publicName: string): ProxyRef | null {
  const at = publicName.indexOf(PROXY_SEPARATOR);
  if (at <= 0) return null;
  const server = publicName.slice(0, at);
  const entry = publicName.slice(at + PROXY_SEPARATOR.length);
  if (!entry || !isUpstreamName(server)) return null;
  return { server, entry };
}

export function proxyResourceUri(server: string, uri: string): string {
  return `${PROXY_URI_PREFIX}${server}://${uri}`;
}

export function splitProxyResourceUri(publicUri: string): ProxyRef | null {
  if (!publicUri.startsWith(PROXY_URI_PREFIX)) return null;
  const rest = publicUri.slice(PROXY_URI_PREFIX.length);
  const at = rest.indexOf('://');
  if (at <= 0) return null;
  const server = rest.slice(0, at);
  const entry = rest.slice(at + 3);
  if (!entry || !isUpstreamName(server)) return null;
  return { server, entry };
}
