import type { IncomingMessage, ServerResponse } from 'node:http';

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
  oauth?: any;
  connectors?: any;
  metrics?: any;
  environment?: any;
  vault?: any;
  database?: any;
  activity?: any;
  mcpDiagnostics?: () => unknown;
  safeMode?: () => boolean;
}

export type AdminRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: AdminApiContext,
) => boolean | Promise<boolean>;
