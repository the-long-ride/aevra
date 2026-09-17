import { UpstreamClient } from '../../../packages/mcp-upstream/src/client.js';
import { createTransport } from '../../../packages/mcp-upstream/src/create-transport.js';
import { UpstreamError } from '../../../packages/mcp-upstream/src/protocol.js';
import type {
  UpstreamCatalog,
  UpstreamServerInfo,
} from '../../../packages/mcp-upstream/src/protocol.js';
import type { UpstreamTransportConfig } from '../../../packages/mcp-upstream/src/transport.js';
import type {
  McpUpstreamCall,
  McpUpstreamSessionStatus,
} from '../../../packages/protocol/src/mcp-upstream.js';

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const DEGRADED_AFTER_FAILURES = 3;

export interface UpstreamClientLike {
  connect(): Promise<UpstreamServerInfo>;
  info(): UpstreamServerInfo | null;
  catalog(): Promise<UpstreamCatalog>;
  callTool(name: string, args: unknown): Promise<unknown>;
  readResource(uri: string): Promise<unknown>;
  getPrompt(name: string, args?: unknown): Promise<unknown>;
  close(): Promise<void>;
  onNotification(handler: (method: string, params: unknown) => void): void;
  onClosed?(handler: () => void): void;
}

export interface UpstreamRegistryDeps {
  createClient(config: UpstreamTransportConfig): UpstreamClientLike;
  now(): number;
}

interface Session {
  upstreamId: string;
  config: UpstreamTransportConfig;
  secrets: string[];
  client: UpstreamClientLike | null;
  opening: UpstreamClientLike | null;
  connecting: Promise<UpstreamClientLike> | null;
  failures: number;
  retryNotBefore: number;
  lastError: string | null;
  listChangedAt: string | null;
}

function secretValuesOf(config: UpstreamTransportConfig): string[] {
  const values =
    config.transport === 'stdio'
      ? Object.values(config.env ?? {})
      : Object.values(config.headers ?? {});
  return values.filter((value) => value.length > 0);
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out;
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        redact(key, secrets),
        redactValue(nested, secrets),
      ]),
    );
  return value;
}

function redactError(error: unknown, secrets: string[]): Error {
  if (error instanceof UpstreamError)
    return new UpstreamError(
      error.code,
      redact(error.message, secrets),
      redactValue(error.details, secrets),
    );
  const wrapped = new Error(
    redact(error instanceof Error ? error.message : String(error), secrets),
  );
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') Object.assign(wrapped, { code });
  const details = (error as { details?: unknown } | null)?.details;
  if (details !== undefined) Object.assign(wrapped, { details: redactValue(details, secrets) });
  return wrapped;
}

export class UpstreamSessionRegistry {
  private sessions = new Map<string, Session>();

  constructor(private readonly deps: UpstreamRegistryDeps) {}

  async connect(
    upstreamId: string,
    config: UpstreamTransportConfig,
  ): Promise<McpUpstreamSessionStatus> {
    await this.disconnect(upstreamId);
    const session: Session = {
      upstreamId,
      config,
      secrets: secretValuesOf(config),
      client: null,
      opening: null,
      connecting: null,
      failures: 0,
      retryNotBefore: 0,
      lastError: null,
      listChangedAt: null,
    };
    this.sessions.set(upstreamId, session);
    await this.client(session);
    return this.statusOf(session);
  }

  async catalog(upstreamId: string): Promise<UpstreamCatalog> {
    const session = this.require(upstreamId);
    const client = await this.client(session);
    return this.guard(session, client, () => client.catalog());
  }

  async call(upstreamId: string, call: McpUpstreamCall): Promise<unknown> {
    const session = this.require(upstreamId);
    // Recovery belongs to core, which validates the replacement catalog before forwarding.
    const client = session.client;
    if (!client && this.deps.now() < session.retryNotBefore)
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        `Upstream ${upstreamId} is unavailable and is not being retried yet`,
      );
    if (!client)
      throw new UpstreamError(
        'UPSTREAM_DIED',
        'The upstream must reconnect and validate its catalog before calls',
      );
    return this.guard(session, client, () => {
      if (call.method === 'tool') return client.callTool(call.name, call.arguments);
      if (call.method === 'resource') return client.readResource(call.uri);
      return client.getPrompt(call.name, call.arguments);
    });
  }

  status(upstreamId?: string): McpUpstreamSessionStatus[] {
    const sessions =
      upstreamId === undefined
        ? [...this.sessions.values()]
        : [this.sessions.get(upstreamId)].filter((session): session is Session => Boolean(session));
    return sessions.map((session) => this.statusOf(session));
  }

  async disconnect(upstreamId?: string): Promise<void> {
    const targets =
      upstreamId === undefined
        ? [...this.sessions.keys()]
        : this.sessions.has(upstreamId)
          ? [upstreamId]
          : [];
    for (const id of targets) {
      const session = this.sessions.get(id);
      this.sessions.delete(id);
      const client = session?.client ?? session?.opening;
      if (!client) continue;
      try {
        await client.close();
      } catch {
        /* teardown is unconditional */
      }
    }
  }

  private require(upstreamId: string): Session {
    const session = this.sessions.get(upstreamId);
    if (!session)
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        `No upstream session is configured for ${upstreamId}`,
      );
    return session;
  }

  private async client(session: Session): Promise<UpstreamClientLike> {
    if (session.client) return session.client;
    if (this.deps.now() < session.retryNotBefore) {
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        `Upstream ${session.upstreamId} is unavailable and is not being retried yet`,
        {
          failures: session.failures,
          retryAfter: new Date(session.retryNotBefore).toISOString(),
        },
      );
    }
    if (session.connecting) return session.connecting;
    const attempt = this.open(session);
    session.connecting = attempt;
    try {
      return await attempt;
    } finally {
      session.connecting = null;
    }
  }

  private async open(session: Session): Promise<UpstreamClientLike> {
    const client = this.deps.createClient(session.config);
    session.opening = client;
    let closed = false;
    client.onClosed?.(() => {
      closed = true;
      if (this.sessions.get(session.upstreamId) !== session || session.client !== client) return;
      session.client = null;
      this.recordFailure(
        session,
        new UpstreamError('UPSTREAM_DIED', 'The upstream session closed unexpectedly'),
      );
    });
    client.onNotification((method) => {
      if (method.startsWith('notifications/') && method.endsWith('/list_changed')) {
        session.listChangedAt = new Date(this.deps.now()).toISOString();
      }
    });
    try {
      await client.connect();
      if (closed || this.sessions.get(session.upstreamId) !== session)
        throw new UpstreamError('UPSTREAM_DIED', 'The upstream session closed during handshake');
    } catch (error) {
      try {
        await client.close();
      } catch {
        /* failed handshake may have nothing to close */
      }
      const safeError = redactError(error, session.secrets);
      this.recordFailure(session, safeError);
      throw safeError;
    } finally {
      if (session.opening === client) session.opening = null;
    }
    session.client = client;
    session.failures = 0;
    session.retryNotBefore = 0;
    session.lastError = null;
    return client;
  }

  private async guard<T>(
    session: Session,
    client: UpstreamClientLike,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return redactValue(await run(), session.secrets) as T;
    } catch (error) {
      const code = error instanceof UpstreamError ? error.code : null;
      if (
        code === 'UPSTREAM_DIED' ||
        code === 'UPSTREAM_CONNECT_FAILED' ||
        code === 'UPSTREAM_TIMEOUT'
      ) {
        if (session.client === client) {
          session.client = null;
          await client.close().catch(() => {});
          this.recordFailure(session, error);
        }
      }
      throw redactError(error, session.secrets);
    }
  }

  private recordFailure(session: Session, error: unknown): void {
    session.failures += 1;
    const raw = error instanceof Error ? error.message : String(error);
    session.lastError = redact(raw, session.secrets);
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (session.failures - 1), MAX_BACKOFF_MS);
    session.retryNotBefore = this.deps.now() + backoff;
  }

  private statusOf(session: Session): McpUpstreamSessionStatus {
    const info = session.client?.info() ?? null;
    return {
      upstreamId: session.upstreamId,
      state: session.client
        ? 'connected'
        : session.failures >= DEGRADED_AFTER_FAILURES
          ? 'degraded'
          : 'idle',
      server: info
        ? { name: info.name, version: info.version, protocolVersion: info.protocolVersion }
        : null,
      failures: session.failures,
      retryAfter:
        session.retryNotBefore > this.deps.now()
          ? new Date(session.retryNotBefore).toISOString()
          : null,
      lastError: session.lastError,
      listChangedAt: session.listChangedAt,
    };
  }
}

class McpUpstreamRuntime {
  private sessions = new UpstreamSessionRegistry({
    createClient: (config) => new UpstreamClient(createTransport(config)),
    now: () => Date.now(),
  });

  registry(): UpstreamSessionRegistry {
    return this.sessions;
  }
  async shutdown(): Promise<void> {
    await this.sessions.disconnect();
  }
}

export const mcpUpstreamRuntime = new McpUpstreamRuntime();
