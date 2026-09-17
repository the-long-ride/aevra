import {
  catalogDiff,
  catalogFingerprint,
} from '../../../../packages/mcp-upstream/src/fingerprint.js';
import type { UpstreamCatalog } from '../../../../packages/mcp-upstream/src/protocol.js';
import type { McpUpstreamCall } from '../../../../packages/protocol/src/mcp-upstream.js';
import { redactSecrets, resolveUpstreamTransport } from './credential-resolver.js';
import { invalidUpstream, type UpstreamRecord } from './upstream-records.js';
import type { UpstreamPatch } from './upstream-repository.js';
import type { UpstreamRegistryDeps, UpstreamRefreshResult } from './upstream-registry-service.js';

function invalid(message: string, code: string): Error {
  return invalidUpstream(message, code);
}

function redactValue(value: unknown, knownSecrets: string[]): unknown {
  if (typeof value === 'string') return redactSecrets(value, knownSecrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, knownSecrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        redactSecrets(key, knownSecrets),
        redactValue(nested, knownSecrets),
      ]),
    );
  return value;
}

export class UpstreamRegistryRuntime {
  private readonly cache = new Map<string, UpstreamCatalog>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly listChangedAt = new Map<string, string>();

  constructor(private readonly deps: UpstreamRegistryDeps) {}

  timestamp(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  explain(error: unknown, knownSecrets: string[]): string {
    return redactSecrets(error instanceof Error ? error.message : String(error), knownSecrets);
  }

  require(id: string): UpstreamRecord {
    const record = this.deps.repository.get(id);
    if (!record)
      throw Object.assign(new Error(`No upstream ${id}`), { code: 'NOT_FOUND', status: 404 });
    return record;
  }

  patch(id: string, patch: UpstreamPatch): UpstreamRecord {
    const next = this.deps.repository.update(id, patch, this.timestamp());
    if (!next)
      throw Object.assign(new Error(`No upstream ${id}`), { code: 'NOT_FOUND', status: 404 });
    return next;
  }

  cacheCatalog(id: string, catalog: UpstreamCatalog): void {
    this.cache.set(id, catalog);
  }

  catalogFor(record: UpstreamRecord | null): UpstreamCatalog | null {
    return record ? (this.cache.get(record.id) ?? record.pendingCatalog ?? record.catalog) : null;
  }

  hasLock(id: string): boolean {
    return this.locks.has(id);
  }

  async refresh(id: string): Promise<UpstreamRefreshResult> {
    return this.withLock(id, () => this.refreshUnlocked(id));
  }

  withLockForUpdate<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return this.withLock(id, operation);
  }

  private async refreshUnlocked(id: string): Promise<UpstreamRefreshResult> {
    const record = this.require(id);
    const resolved = await resolveUpstreamTransport(record, this.deps.secrets);
    let catalog: UpstreamCatalog;
    try {
      await this.deps.worker.connect(record.id, resolved.config);
      catalog = await this.deps.worker.catalog(record.id);
    } catch (error) {
      this.patch(record.id, { state: 'degraded' });
      throw invalid(
        `Could not reach upstream ${record.name}: ${this.explain(error, resolved.knownSecrets)}`,
        'MCP_UPSTREAM_UNREACHABLE',
      );
    }
    const fingerprint = catalogFingerprint(catalog);
    if (record.catalogFingerprint !== null && record.catalogFingerprint !== fingerprint) {
      this.cacheCatalog(record.id, catalog);
      return {
        record: this.patch(record.id, {
          pendingCatalog: catalog,
          pendingCatalogDiff: catalogDiff(record.catalog, catalog),
          state: 'needs-review',
        }),
        catalog,
        changed: true,
      };
    }
    this.cacheCatalog(record.id, catalog);
    return {
      record: this.patch(record.id, {
        catalog,
        pendingCatalog: null,
        catalogFingerprint: fingerprint,
        pendingCatalogDiff: null,
        state: 'active',
      }),
      catalog,
      changed: false,
    };
  }

  async test(id: string) {
    const result = await this.refresh(id);
    return {
      ok: true,
      serverName: result.record.name,
      serverVersion: null,
      toolCount: result.catalog.tools.length,
      resourceCount: result.catalog.resources.length,
      promptCount: result.catalog.prompts.length,
      state: result.record.state,
      message: null,
    };
  }

  async remove(id: string): Promise<void> {
    await this.withLock(id, async () => {
      const record = this.require(id);
      await this.deps.worker.disconnect(record.id).catch(() => {});
      this.cache.delete(record.id);
      this.listChangedAt.delete(record.id);
      this.deps.repository.remove(record.id);
    });
  }

  async callTool(name: string, tool: string, args: unknown): Promise<unknown> {
    await this.reconcileChanged();
    return this.forward(name, (record) =>
      this.redactedCall(record, { method: 'tool', name: tool, arguments: args }),
    );
  }

  async readResource(name: string, uri: string): Promise<unknown> {
    await this.reconcileChanged();
    return this.forward(name, (record) => this.redactedCall(record, { method: 'resource', uri }));
  }

  async getPrompt(name: string, prompt: string, args?: unknown): Promise<unknown> {
    await this.reconcileChanged();
    return this.forward(name, (record) =>
      this.redactedCall(record, { method: 'prompt', name: prompt, arguments: args }),
    );
  }

  async reconcileChanged(): Promise<void> {
    for (const record of this.deps.repository.list()) {
      if (!record.enabled) continue;
      const status = await this.deps.worker.status(record.id).catch(() => null);
      if (!status?.listChangedAt) continue;
      const latest = this.listChangedAt.get(record.id);
      if (latest === status.listChangedAt) continue;
      this.listChangedAt.set(record.id, status.listChangedAt);
      try {
        await this.refresh(record.id);
      } catch {
        this.listChangedAt.delete(record.id);
      }
    }
  }

  async restoreSession(record: UpstreamRecord): Promise<boolean> {
    try {
      const resolved = await resolveUpstreamTransport(record, this.deps.secrets);
      await this.deps.worker.connect(record.id, resolved.config);
      const catalog = await this.deps.worker.catalog(record.id);
      this.cacheCatalog(record.id, catalog);
      const fingerprint = catalogFingerprint(catalog);
      if (record.catalogFingerprint !== null && fingerprint !== record.catalogFingerprint) {
        this.patch(record.id, {
          pendingCatalog: catalog,
          pendingCatalogDiff: catalogDiff(record.catalog, catalog),
          state: 'needs-review',
        });
      } else if (record.state === 'degraded') {
        this.patch(record.id, { state: 'active' });
      }
      return true;
    } catch {
      await this.deps.worker.disconnect(record.id).catch(() => {});
      return false;
    }
  }

  private forwardable(name: string): UpstreamRecord {
    const record = this.deps.repository.findByName(name);
    if (!record) throw invalid(`No MCP upstream named ${name}`, 'MCP_UPSTREAM_UNKNOWN');
    if (!record.enabled) throw invalid(`MCP upstream ${name} is disabled`, 'MCP_UPSTREAM_DISABLED');
    if (record.state === 'needs-review')
      throw invalid(
        `MCP upstream ${name} changed its catalog and is awaiting review`,
        'MCP_UPSTREAM_NEEDS_REVIEW',
      );
    if (record.state === 'degraded')
      throw invalid(`MCP upstream ${name} is not reachable`, 'MCP_UPSTREAM_DEGRADED');
    return record;
  }

  private async redactedCall(record: UpstreamRecord, call: McpUpstreamCall): Promise<unknown> {
    const resolved = await resolveUpstreamTransport(record, this.deps.secrets);
    try {
      return redactValue(await this.deps.worker.call(record.id, call), resolved.knownSecrets);
    } catch (error) {
      if (error instanceof Error) {
        error.message = redactSecrets(error.message, resolved.knownSecrets);
        const details = (error as { details?: unknown }).details;
        if (details !== undefined)
          Object.assign(error, { details: redactValue(details, resolved.knownSecrets) });
      }
      throw error;
    }
  }

  private async ensureConnected(record: UpstreamRecord): Promise<void> {
    const status = await this.deps.worker.status(record.id).catch(() => null);
    if (status?.state === 'connected' && !status.listChangedAt) return;
    const resolved = await resolveUpstreamTransport(record, this.deps.secrets);
    await this.deps.worker.connect(record.id, resolved.config);
    const catalog = await this.deps.worker.catalog(record.id);
    const fingerprint = catalogFingerprint(catalog);
    this.cacheCatalog(record.id, catalog);
    if (record.catalogFingerprint !== null && fingerprint !== record.catalogFingerprint) {
      this.patch(record.id, {
        pendingCatalog: catalog,
        pendingCatalogDiff: catalogDiff(record.catalog, catalog),
        state: 'needs-review',
      });
    } else if (record.state === 'degraded') {
      this.patch(record.id, { state: 'active' });
    }
  }

  private async forward<T>(
    name: string,
    operation: (record: UpstreamRecord) => Promise<T>,
  ): Promise<T> {
    const current = this.deps.repository.findByName(name) ?? this.forwardable(name);
    return this.withLock(current.id, async () => {
      const record = this.forwardable(name);
      await this.ensureConnected(record);
      return operation(this.forwardable(name));
    });
  }

  private async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(id, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }
}
