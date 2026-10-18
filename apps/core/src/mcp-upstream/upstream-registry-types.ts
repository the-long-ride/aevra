import type { UpstreamTransportConfig } from '../../../../packages/mcp-upstream/src/transport.js';
import type { UpstreamCatalog } from '../../../../packages/mcp-upstream/src/protocol.js';
import type { RiskTier } from '../../../../packages/protocol/src/index.js';
import type {
  McpUpstreamCall,
  McpUpstreamSessionStatus,
} from '../../../../packages/protocol/src/mcp-upstream.js';
import type { SecretStore } from '../../../../packages/secrets/src/store.js';
import type { UpstreamAuth, UpstreamRecord, UpstreamTransportKind } from './upstream-records.js';
import type { UpstreamRepository } from './upstream-repository.js';

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
  /** Upper bound a list request waits for catalog change detection. Defaults to 2000 ms. */
  listReconcileTimeoutMs?: number;
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
/** Outcome of a write that may flip `enabled`; `warning` explains a partial teardown or check. */
export interface UpstreamToggleResult {
  record: UpstreamRecord;
  changed: boolean;
  warning?: string;
}
