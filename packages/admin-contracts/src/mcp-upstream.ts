/** Documentation received from an upstream MCP catalog, never executable UI content. */
export interface McpUpstreamToolDocumentation {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export type McpUpstreamDocumentationSource = 'accepted' | 'pending' | 'unavailable';
