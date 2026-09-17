import { randomUUID } from 'node:crypto';
import {
  catalogDiff,
  catalogFingerprint,
} from '../../../../packages/mcp-upstream/src/fingerprint.js';
import type { UpstreamCatalog } from '../../../../packages/mcp-upstream/src/protocol.js';
import type { UpstreamTransportConfig } from '../../../../packages/mcp-upstream/src/transport.js';
import type { RiskTier } from '../../../../packages/protocol/src/index.js';
import type {
  McpUpstreamCall,
  McpUpstreamSessionStatus,
} from '../../../../packages/protocol/src/mcp-upstream.js';
import type { SecretStore } from '../../../../packages/secrets/src/store.js';
import { resolveUpstreamTransport } from './credential-resolver.js';
import {
  assertValidUpstreamName,
  invalidUpstream,
  parseStoredConfig,
  type UpstreamAuth,
  type UpstreamRecord,
  type UpstreamTransportKind,
} from './upstream-records.js';
import type { UpstreamRepository } from './upstream-repository.js';
import { UpstreamRegistryRuntime } from './upstream-registry-runtime.js';

export interface UpstreamWorkerGateway {
  connect(upstreamId: string, config: UpstreamTransportConfig): Promise<void>;
  catalog(upstreamId: string): Promise<UpstreamCatalog>;
  disconnect(upstreamId: string): Promise<void>;
  status(upstreamId: string): Promise<McpUpstreamSessionStatus | null>;
  call(upstreamId: string, call: McpUpstreamCall): Promise<unknown>;
}
export interface UpstreamRegistryDeps {
  repository: UpstreamRepository;
  secrets: SecretStore;
  worker: UpstreamWorkerGateway;
  now?: () => Date;
}
export interface UpstreamRegisterInput {
  name: string;
  transport: UpstreamTransportKind;
  config: unknown;
  auth?: UpstreamAuth;
  risk: RiskTier;
}
export interface UpstreamRefreshResult {
  record: UpstreamRecord;
  catalog: UpstreamCatalog;
  changed: boolean;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export class UpstreamRegistryService {
  private readonly runtime: UpstreamRegistryRuntime;

  constructor(private readonly deps: UpstreamRegistryDeps) {
    this.runtime = new UpstreamRegistryRuntime(deps);
  }

  list(): UpstreamRecord[] {
    return this.deps.repository.list();
  }
  async create(input: UpstreamRegisterInput): Promise<UpstreamRecord> {
    return this.register(input);
  }
  get(id: string): UpstreamRecord | null {
    return this.deps.repository.get(id);
  }
  cachedCatalog(id: string): UpstreamCatalog | null {
    return this.runtime.catalogFor(this.get(id));
  }
  serving(): Array<{ record: UpstreamRecord; catalog: UpstreamCatalog }> {
    return this.deps.repository.list().flatMap((record) => {
      const catalog = this.runtime.catalogFor(record);
      return !this.runtime.hasLock(record.id) &&
        record.enabled &&
        record.state === 'active' &&
        catalog
        ? [{ record, catalog }]
        : [];
    });
  }

  async register(input: UpstreamRegisterInput): Promise<UpstreamRecord> {
    assertValidUpstreamName(input.name);
    if (this.deps.repository.findByName(input.name))
      throw invalidUpstream(
        `An upstream named ${input.name} is already registered`,
        'MCP_UPSTREAM_NAME_TAKEN',
      );
    const now = this.runtime.timestamp();
    const record: UpstreamRecord = {
      id: `mu_${randomUUID()}`,
      name: input.name,
      transport: input.transport,
      config: parseStoredConfig(input.transport, input.config),
      auth: input.auth ?? {},
      risk: input.risk,
      enabled: true,
      catalogFingerprint: null,
      catalog: null,
      pendingCatalog: null,
      pendingCatalogDiff: null,
      state: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const resolved = await resolveUpstreamTransport(record, this.deps.secrets);
    let catalog: UpstreamCatalog;
    try {
      await this.deps.worker.connect(record.id, resolved.config);
      catalog = await this.deps.worker.catalog(record.id);
    } catch (error) {
      await this.deps.worker.disconnect(record.id).catch(() => {});
      throw invalidUpstream(
        `The upstream server did not complete a handshake: ${this.runtime.explain(error, resolved.knownSecrets)}`,
        'MCP_UPSTREAM_HANDSHAKE_FAILED',
      );
    }
    record.catalogFingerprint = catalogFingerprint(catalog);
    record.catalog = catalog;
    this.deps.repository.insert(record);
    this.runtime.cacheCatalog(record.id, catalog);
    return record;
  }

  refresh(id: string) {
    return this.runtime.refresh(id);
  }
  test(id: string) {
    return this.runtime.test(id);
  }
  async update(id: string, input: Partial<UpstreamRegisterInput> & { enabled?: boolean }) {
    return this.runtime.withLockForUpdate(id, () => this.updateUnlocked(id, input));
  }

  private async updateUnlocked(
    id: string,
    input: Partial<UpstreamRegisterInput> & { enabled?: boolean },
  ) {
    const current = this.runtime.require(id);
    const name = input.name ?? current.name;
    assertValidUpstreamName(name);
    if (name !== current.name) {
      const existing = this.deps.repository.findByName(name);
      if (existing && existing.id !== current.id)
        throw invalidUpstream(
          `An upstream named ${name} is already registered`,
          'MCP_UPSTREAM_NAME_TAKEN',
        );
    }
    const transport = input.transport ?? current.transport;
    const config =
      input.config === undefined ? current.config : parseStoredConfig(transport, input.config);
    const auth = input.auth ?? current.auth;
    const patch = {
      name,
      ...(input.risk === undefined ? {} : { risk: input.risk }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    };
    const connectionChanged =
      (input.transport !== undefined && input.transport !== current.transport) ||
      (input.config !== undefined && !sameJson(config, current.config)) ||
      (input.auth !== undefined && !sameJson(auth, current.auth));
    if (!connectionChanged) return this.runtime.patch(id, { ...patch });

    const next: UpstreamRecord = {
      ...current,
      ...patch,
      transport,
      config,
      auth,
      catalog: current.catalog,
      pendingCatalog: null,
      catalogFingerprint: current.catalogFingerprint,
      pendingCatalogDiff: null,
      state: current.state,
    };
    const resolved = await resolveUpstreamTransport(next, this.deps.secrets);
    let catalog: UpstreamCatalog;
    try {
      await this.deps.worker.connect(next.id, resolved.config);
      catalog = await this.deps.worker.catalog(next.id);
    } catch (error) {
      await this.deps.worker.disconnect(next.id).catch(() => {});
      if (!(await this.runtime.restoreSession(current)))
        this.runtime.patch(id, { state: 'degraded' });
      throw invalidUpstream(
        `The upstream server did not complete an update handshake: ${this.runtime.explain(error, resolved.knownSecrets)}`,
        'MCP_UPSTREAM_HANDSHAKE_FAILED',
      );
    }
    const fingerprint = catalogFingerprint(catalog);
    this.runtime.cacheCatalog(next.id, catalog);
    if (
      current.catalogFingerprint !== null &&
      (fingerprint !== current.catalogFingerprint || current.state === 'needs-review')
    )
      return this.runtime.patch(id, {
        ...patch,
        transport,
        config,
        auth,
        pendingCatalog: catalog,
        pendingCatalogDiff: catalogDiff(current.catalog, catalog),
        state: 'needs-review',
      });
    return this.runtime.patch(id, {
      ...patch,
      transport,
      config,
      auth,
      catalog,
      pendingCatalog: null,
      catalogFingerprint: fingerprint,
      pendingCatalogDiff: null,
      state: 'active',
    });
  }

  acknowledge(id: string): UpstreamRecord {
    const record = this.runtime.require(id);
    const catalog = record.pendingCatalog ?? this.runtime.catalogFor(record);
    if (!catalog)
      throw invalidUpstream(
        `Upstream ${record.name} has no fetched catalog to acknowledge; test it first`,
        'MCP_UPSTREAM_NO_PENDING_CATALOG',
      );
    return this.runtime.patch(record.id, {
      catalog,
      pendingCatalog: null,
      catalogFingerprint: catalogFingerprint(catalog),
      pendingCatalogDiff: null,
      state: 'active',
    });
  }
  setEnabled(id: string, enabled: boolean): UpstreamRecord {
    this.runtime.require(id);
    return this.runtime.patch(id, { enabled });
  }
  markDegraded(id: string): UpstreamRecord {
    this.runtime.require(id);
    return this.runtime.patch(id, { state: 'degraded' });
  }
  remove(id: string) {
    return this.runtime.remove(id);
  }
  findByName(name: string): UpstreamRecord | null {
    return this.deps.repository.findByName(name);
  }
  catalogByName(name: string): UpstreamCatalog | null {
    return this.runtime.catalogFor(this.findByName(name));
  }
  callTool(name: string, tool: string, args: unknown) {
    return this.runtime.callTool(name, tool, args);
  }
  readResource(name: string, uri: string) {
    return this.runtime.readResource(name, uri);
  }
  getPrompt(name: string, prompt: string, args?: unknown) {
    return this.runtime.getPrompt(name, prompt, args);
  }
  reconcileChanged() {
    return this.runtime.reconcileChanged();
  }
  markNeedsReview(id: string): UpstreamRecord {
    return this.runtime.patch(id, { state: 'needs-review' });
  }
}
