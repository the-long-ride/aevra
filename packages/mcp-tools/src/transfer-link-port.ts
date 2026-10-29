import type { ProtectedGlob } from '../../protocol/src/worker.js';

/** What the connector that called files_upload may mint a one-time link for (R5). */
export interface TransferLinkInput {
  /** Connection id, or the session id when the caller has no connection. */
  connectionId: string;
  sessionId: string;
  actor: string;
  workspaceId: string;
  path: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  protectedGlobs?: ProtectedGlob[];
}

/** Structural, so mcp-tools does not depend on the core link store class. */
export interface TransferLinkPort {
  /** False while there is no public base URL to put in a link. */
  canMint(): boolean;
  mint(input: TransferLinkInput): { id: string; url: string; expiresAt: string };
}
