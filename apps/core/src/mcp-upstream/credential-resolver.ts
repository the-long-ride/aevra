import type { UpstreamTransportConfig } from '../../../../packages/mcp-upstream/src/transport.js';
import type { SecretStore } from '../../../../packages/secrets/src/store.js';
import { invalidUpstream, type UpstreamRecord } from './upstream-records.js';

const MIN_REDACTABLE_LENGTH = 8;
export interface ResolvedUpstreamTransport {
  config: UpstreamTransportConfig;
  knownSecrets: string[];
}

export function redactSecrets(text: string, knownSecrets: string[]): string {
  let out = text;
  for (const secret of knownSecrets)
    if (secret.length >= MIN_REDACTABLE_LENGTH) out = out.split(secret).join('[redacted]');
  return out;
}

async function requireSecret(secrets: SecretStore, refId: string): Promise<string> {
  const value = await secrets.get(refId);
  if (value === null)
    throw invalidUpstream(
      `Secret reference ${refId} is not configured`,
      'MCP_UPSTREAM_SECRET_MISSING',
    );
  return value;
}

export async function resolveUpstreamTransport(
  record: UpstreamRecord,
  secrets: SecretStore,
): Promise<ResolvedUpstreamTransport> {
  const knownSecrets: string[] = [];
  if (record.transport === 'stdio') {
    const config = record.config as { command: string; args: string[]; cwd?: string };
    const env: Record<string, string> = {};
    for (const [name, refId] of Object.entries(record.auth.env ?? {})) {
      const value = await requireSecret(secrets, refId);
      env[name] = value;
      knownSecrets.push(value);
    }
    return {
      config: {
        transport: 'stdio',
        command: config.command,
        args: config.args,
        ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
        ...(knownSecrets.length ? { env } : {}),
      },
      knownSecrets,
    };
  }
  const config = record.config as { url: string };
  const headers: Record<string, string> = {};
  const { header, secretRefId } = record.auth;
  if (secretRefId) {
    if (!header)
      throw invalidUpstream(
        'An http or sse credential needs a header name alongside its secret reference',
        'MCP_UPSTREAM_AUTH_INVALID',
      );
    const value = await requireSecret(secrets, secretRefId);
    headers[header] = value;
    knownSecrets.push(value);
  }
  return {
    config: {
      transport: record.transport,
      url: config.url,
      ...(knownSecrets.length ? { headers } : {}),
    },
    knownSecrets,
  };
}
