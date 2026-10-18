import type {
  UpstreamRegistryDeps,
  UpstreamRegisterInput,
  UpstreamToggleResult,
} from './upstream-registry-types.js';
export type {
  UpstreamWorkerGateway,
  UpstreamRegistryDeps,
  UpstreamRegisterInput,
  UpstreamRefreshResult,
  UpstreamToggleResult,
} from './upstream-registry-types.js';
import { sameJson } from './json-equality.js';
import { randomUUID } from 'node:crypto';
import {
  catalogDiff,
  catalogFingerprint,
} from '../../../../packages/mcp-upstream/src/fingerprint.js';
import type { UpstreamCatalog } from '../../../../packages/mcp-upstream/src/protocol.js';
import { resolveUpstreamTransport } from './credential-resolver.js';
import {
  assertValidUpstreamName,
  invalidUpstream,
  parseStoredConfig,
  type UpstreamRecord,
} from './upstream-records.js';
import type { UpstreamPatch } from './upstream-repository.js';
import { ListReconciler } from './list-reconciler.js';
import { UpstreamRegistryRuntime } from './upstream-registry-runtime.js';

export class UpstreamRegistryService {
  private readonly runtime: UpstreamRegistryRuntime;
  private readonly listReconciler: ListReconciler;
  private readonly enablementEpoch = new Map<string, number>();
  private readonly warnings = new Map<string, string>();

  constructor(private readonly deps: UpstreamRegistryDeps) {
    this.runtime = new UpstreamRegistryRuntime(deps);
    this.listReconciler = new ListReconciler(
      () => this.runtime.reconcileChanged({ retryFailed: false }),
      deps.listReconcileTimeoutMs,
    );
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
    return (await this.updateReporting(id, input)).record;
  }
  /** Like update(), and also reports whether `enabled` flipped, read under the same lock. */
  updateReporting(
    id: string,
    input: Partial<UpstreamRegisterInput> & { enabled?: boolean },
  ): Promise<UpstreamToggleResult> {
    return this.runtime.withLockForUpdate(id, async () => {
      const before = this.runtime.require(id).enabled;
      this.warnings.delete(id);
      const record = await this.updateUnlocked(id, input);
      const warning = this.warnings.get(id);
      this.warnings.delete(id);
      return { record, changed: record.enabled !== before, ...(warning ? { warning } : {}) };
    });
  }

  private async updateUnlocked(
    id: string,
    input: Partial<UpstreamRegisterInput> & { enabled?: boolean },
  ) {
    const current = this.runtime.require(id);
    const epoch = this.enablementEpoch.get(id);
    const stale = () => this.enablementEpoch.get(id) !== epoch;
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
    if (!connectionChanged) return this.persist(id, patch);
    // A disabled server must not run: persist without a handshake, marked degraded
    // (never served) so setEnabled(true) runs the handshake and fingerprint diff.
    if (!(input.enabled ?? current.enabled))
      return this.persist(id, { ...patch, transport, config, auth, state: 'degraded' });

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
    if (stale()) return this.runtime.require(id);
    let catalog: UpstreamCatalog;
    try {
      await this.deps.worker.connect(next.id, resolved.config);
      if (stale()) {
        await this.disconnect(id);
        return this.runtime.require(id);
      }
      catalog = await this.deps.worker.catalog(next.id);
    } catch (error) {
      await this.deps.worker.disconnect(next.id).catch(() => {});
      // Only a server that was running gets its previous connection back.
      if (!stale() && this.runtime.require(id).enabled && current.enabled) {
        const restored = await this.runtime.restoreSession(current, () => !stale());
        if (!stale() && !restored) this.runtime.patch(id, { state: 'degraded' });
      }
      throw invalidUpstream(
        `The upstream server did not complete an update handshake: ${this.runtime.explain(error, resolved.knownSecrets)}`,
        'MCP_UPSTREAM_HANDSHAKE_FAILED',
      );
    }
    if (stale()) {
      await this.disconnect(id);
      return this.runtime.require(id);
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

  acknowledge(id: string, expectedFingerprint?: string): UpstreamRecord {
    const record = this.runtime.require(id);
    const catalog = record.pendingCatalog ?? this.runtime.catalogFor(record);
    if (!catalog)
      throw invalidUpstream(
        `Upstream ${record.name} has no fetched catalog to acknowledge; test it first`,
        'MCP_UPSTREAM_NO_PENDING_CATALOG',
      );
    if (!expectedFingerprint || expectedFingerprint !== catalogFingerprint(catalog))
      throw invalidUpstream(
        'The catalog changed after review; refresh and review it again',
        'MCP_UPSTREAM_CATALOG_CHANGED',
      );
    return this.runtime.patch(record.id, {
      catalog,
      pendingCatalog: null,
      catalogFingerprint: catalogFingerprint(catalog),
      pendingCatalogDiff: null,
      state: 'active',
    });
  }
  async setEnabled(id: string, enabled: boolean): Promise<UpstreamToggleResult> {
    const current = this.runtime.require(id);
    this.enablementEpoch.set(id, (this.enablementEpoch.get(id) ?? 0) + 1);
    if (current.enabled === enabled) return { record: current, changed: false };
    if (!enabled) {
      // Not behind the per-server lock: an in-flight call must not delay cut-off.
      const record = this.runtime.patch(id, { enabled: false });
      const warning = await this.disconnect(id);
      // A handshake holding the lock may reconnect; close it once that ends.
      if (this.runtime.hasLock(id))
        void this.runtime
          .withLockForUpdate(id, async () => {
            if (!this.runtime.require(id).enabled) await this.disconnect(id);
          })
          .catch(() => {});
      return { record, changed: true, ...(warning ? { warning } : {}) };
    }
    const record = this.runtime.patch(id, { enabled: true });
    if (record.state !== 'degraded') return { record, changed: true };
    // Edited or unreachable while disabled: verify now; a changed catalog goes to review.
    try {
      return { record: (await this.runtime.refresh(id)).record, changed: true };
    } catch (error) {
      const warning = error instanceof Error ? error.message : String(error);
      return { record: this.runtime.require(id), changed: true, warning };
    }
  }
  /** Writes a patch; a server left disabled has its worker session stopped. */
  private async persist(id: string, patch: UpstreamPatch): Promise<UpstreamRecord> {
    const record = this.runtime.patch(id, patch);
    if (!record.enabled) {
      const warning = await this.disconnect(id);
      if (warning) this.warnings.set(id, warning);
    }
    return record;
  }
  /** Stops one worker session; returns why it failed instead of hiding it. */
  private async disconnect(id: string): Promise<string | undefined> {
    try {
      await this.deps.worker.disconnect(id);
      return undefined;
    } catch (error) {
      const reason = this.runtime.explain(error, []);
      return `The server is disabled, but its connection could not be closed: ${reason}`;
    }
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
  /** Detects catalog changes for a list request: single-flight, time-bounded, never retried. */
  reconcileForList(): Promise<void> {
    return this.listReconciler.settle();
  }
  markNeedsReview(id: string): UpstreamRecord {
    return this.runtime.patch(id, { state: 'needs-review' });
  }
}
