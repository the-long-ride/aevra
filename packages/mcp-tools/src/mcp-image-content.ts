/**
 * A tool result may carry MCP image content blocks under this symbol. The tool
 * envelope appends them after the text block; being a symbol key, they never
 * reach the JSON text or structuredContent.
 */
export const MCP_IMAGE_CONTENT = Symbol.for('aevra.mcp.imageContent');

export interface McpImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
}

export function withImageContent<T extends object>(value: T, images: McpImageBlock[]): T {
  return images.length ? Object.assign(value, { [MCP_IMAGE_CONTENT]: images }) : value;
}

function imagesOf(value: unknown): McpImageBlock[] {
  if (typeof value !== 'object' || value === null) return [];
  const images = (value as Record<symbol, unknown>)[MCP_IMAGE_CONTENT];
  return Array.isArray(images) ? (images as McpImageBlock[]) : [];
}

/** Separates image blocks from a result, returning a copy without the symbol key. */
export function splitImageContent(value: unknown): { data: unknown; images: McpImageBlock[] } {
  const images = imagesOf(value);
  if (!images.length) return { data: value, images };
  const { [MCP_IMAGE_CONTENT]: _images, ...rest } = value as Record<string | symbol, unknown>;
  return { data: rest, images };
}
