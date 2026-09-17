import type { DatabaseSync } from 'node:sqlite';
import type { RiskTier } from '../../../../packages/protocol/src/index.js';
import type { UpstreamCatalog } from '../../../../packages/mcp-upstream/src/protocol.js';
import {
  rowToRecord,
  type UpstreamAuth,
  type UpstreamCatalogDiff,
  type UpstreamRecord,
  type UpstreamState,
  type UpstreamStoredConfig,
  type UpstreamTransportKind,
} from './upstream-records.js';

export interface UpstreamPatch {
  name?: string;
  transport?: UpstreamTransportKind;
  config?: UpstreamStoredConfig;
  auth?: UpstreamAuth;
  enabled?: boolean;
  risk?: RiskTier;
  catalogFingerprint?: string | null;
  catalog?: UpstreamCatalog | null;
  pendingCatalog?: UpstreamCatalog | null;
  pendingCatalogDiff?: UpstreamCatalogDiff | null;
  state?: UpstreamState;
}

const COLUMNS =
  'id,name,transport,config_json configJson,auth_json authJson,risk,enabled,catalog_fingerprint catalogFingerprint,catalog_json catalogJson,pending_catalog_json pendingCatalogJson,pending_catalog_diff_json pendingCatalogDiffJson,state,created_at createdAt,updated_at updatedAt';

export class UpstreamRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(record: UpstreamRecord): UpstreamRecord {
    this.db
      .prepare(
        'INSERT INTO mcp_upstreams(id,name,transport,config_json,auth_json,risk,enabled,catalog_fingerprint,catalog_json,pending_catalog_json,pending_catalog_diff_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        record.id,
        record.name,
        record.transport,
        JSON.stringify(record.config),
        JSON.stringify(record.auth),
        record.risk,
        record.enabled ? 1 : 0,
        record.catalogFingerprint,
        record.catalog ? JSON.stringify(record.catalog) : null,
        record.pendingCatalog ? JSON.stringify(record.pendingCatalog) : null,
        record.pendingCatalogDiff ? JSON.stringify(record.pendingCatalogDiff) : null,
        record.state,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  list(): UpstreamRecord[] {
    return (
      this.db.prepare(`SELECT ${COLUMNS} FROM mcp_upstreams ORDER BY name`).all() as unknown[]
    ).map(rowToRecord);
  }
  get(id: string): UpstreamRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM mcp_upstreams WHERE id=?`).get(id);
    return row ? rowToRecord(row) : null;
  }
  findByName(name: string): UpstreamRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM mcp_upstreams WHERE name=?`).get(name);
    return row ? rowToRecord(row) : null;
  }

  update(id: string, patch: UpstreamPatch, updatedAt: string): UpstreamRecord | null {
    const current = this.get(id);
    if (!current) return null;
    const next: UpstreamRecord = {
      ...current,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.transport === undefined ? {} : { transport: patch.transport }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      ...(patch.auth === undefined ? {} : { auth: patch.auth }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.risk === undefined ? {} : { risk: patch.risk }),
      ...(patch.catalogFingerprint === undefined
        ? {}
        : { catalogFingerprint: patch.catalogFingerprint }),
      ...(patch.catalog === undefined ? {} : { catalog: patch.catalog }),
      ...(patch.pendingCatalog === undefined ? {} : { pendingCatalog: patch.pendingCatalog }),
      ...(patch.pendingCatalogDiff === undefined
        ? {}
        : { pendingCatalogDiff: patch.pendingCatalogDiff }),
      ...(patch.state === undefined ? {} : { state: patch.state }),
      updatedAt,
    };
    this.db
      .prepare(
        'UPDATE mcp_upstreams SET name=?,transport=?,config_json=?,auth_json=?,enabled=?,risk=?,catalog_fingerprint=?,catalog_json=?,pending_catalog_json=?,pending_catalog_diff_json=?,state=?,updated_at=? WHERE id=?',
      )
      .run(
        next.name,
        next.transport,
        JSON.stringify(next.config),
        JSON.stringify(next.auth),
        next.enabled ? 1 : 0,
        next.risk,
        next.catalogFingerprint,
        next.catalog ? JSON.stringify(next.catalog) : null,
        next.pendingCatalog ? JSON.stringify(next.pendingCatalog) : null,
        next.pendingCatalogDiff ? JSON.stringify(next.pendingCatalogDiff) : null,
        next.state,
        next.updatedAt,
        id,
      );
    return next;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM mcp_upstreams WHERE id=?').run(id);
  }
}
