import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SystemCapabilitySnapshot } from '../../../../../packages/protocol/src/index.js';
import type { KeepAwakeService } from '../../power/keep-awake-service.js';
import type { UpstreamRegistryService } from '../../mcp-upstream/upstream-registry-service.js';

export interface AdminApiContext {
  workspaces?: any;
  approvals?: any;
  permissions?: any;
  sessions?: any;
  profiles?: any;
  bootstrap?: any;
  processes?: any;
  changes?: any;
  audit?: any;
  settings?: any;
  cloudflare?: any;
  exposure?: any;
  localFilesystem?: any;
  oauth?: any;
  connections?: any;
  connectors?: any;
  metrics?: any;
  environment?: any;
  vault?: any;
  database?: any;
  activity?: any;
  power?: Pick<KeepAwakeService, 'status' | 'configure'>;
  browser?: any;
  browserPolicy?: any;
  desktopPolicy?: any;
  desktopAccess?: any;
  desktopAppCatalog?: any;
  mcpUpstreams?: UpstreamRegistryService;
  systemCapabilities?: () => SystemCapabilitySnapshot;
  mcpDiagnostics?: () => unknown;
  safeMode?: () => boolean;
  commandEvaluator?: (input: {
    sessionId: string;
    workspaceId?: string;
    request: unknown;
  }) => Promise<{ request?: unknown; analysis: unknown; decision: unknown }>;
}

export type AdminRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: AdminApiContext,
) => boolean | Promise<boolean>;
