import type { AuditService } from '../audit/audit-service.js';
import type { AevraOAuthService } from '../auth/oauth.js';
import type { ConnectorAdmission } from '../mcp/identity-resolver.js';
import { createFileLinkRoute, type FileLinkRouteDeps } from '../mcp/file-link-route.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { WorkspaceService } from '../workspaces/workspace-service.js';
import { TransferLinkStore } from './transfer-links.js';

/**
 * Builds the one-time link store (R5), ties its lifetime to the minting connection, and the
 * `GET /files/<secret>` route. Returns spreadable pieces for the tool deps and the MCP server.
 */
export function fileLinksFor(
  sessions: SessionManager,
  workspaces: WorkspaceService,
  worker: FileLinkRouteDeps['worker'],
  audit: AuditService,
  exposure: { publicUrl(): string | undefined; oauth: AevraOAuthService },
  /** Lazy, because the connector admission is built after the link wiring. */
  connectors?: () => Pick<ConnectorAdmission, 'verify'> | undefined,
) {
  const store = new TransferLinkStore(() => exposure.publicUrl());
  sessions.linkRevoker = (key) => store.revokeByConnection(key);
  const route = createFileLinkRoute({
    links: store,
    worker,
    roots: (workspaceId) => workspaces.capabilityRoots(workspaceId),
    alive: (key) => {
      const state = sessions.connectionState(key);
      return state ? state.status !== 'REVOKED' : Boolean(sessions.get(key));
    },
    identify: async (token, ip) => {
      try {
        const identity = exposure.oauth.verifyAccessToken(token, ip);
        if (identity) return { connectionId: identity.connectionId, actor: identity.actor };
      } catch {
        // Not an OAuth access token: try the static connector tokens.
      }
      try {
        const admitted = await connectors?.()?.verify(token, ip);
        return admitted?.kind === 'admitted' ? { actor: admitted.identity.actor } : null;
      } catch {
        return null;
      }
    },
    audit,
  });
  return { tools: { transferLinks: store }, mcp: { fileLinks: route } };
}
