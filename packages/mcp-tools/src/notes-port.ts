/**
 * Structural view of Core's connector notes. mcp-tools must not depend on the
 * Core class; these methods only return what the user made visible to the AI.
 */
export interface ConnectorNotesPort {
  listVisible(actor: string): Array<{
    id: string;
    title: string;
    text: string;
    images: unknown[];
    aiCanDelete: boolean;
    readOnConnect: boolean;
    updatedAt: string;
  }>;
  readVisible(
    actor: string,
    id: string,
  ):
    | {
        id: string;
        title: string;
        text: string;
        images: Array<{ id: string; name: string; mimeType: string; data: Uint8Array }>;
        aiCanDelete: boolean;
        readOnConnect: boolean;
        updatedAt: string;
      }
    | undefined;
  deleteByAi(actor: string, id: string): 'deleted' | 'not_found' | 'not_deletable';
}
