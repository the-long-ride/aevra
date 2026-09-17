import type { CdpClient } from './cdp-client.js';
import { BrowserDriverError, type ReadRequest } from './driver.js';

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves the node a read is scoped to: an element ref, a CSS selector, or the
 * whole document. Returning the document when the caller named one element
 * would hand back far more of the page than they asked for.
 */
async function readTarget(
  client: CdpClient,
  request: ReadRequest,
  backendNodeIdForRef: (ref: string) => number,
): Promise<Record<string, number>> {
  if (request.ref) return { backendNodeId: backendNodeIdForRef(request.ref) };
  const root = await client.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 });
  if (!request.selector) return { nodeId: root.root.nodeId };
  const found = await client.send<{ nodeId: number }>('DOM.querySelector', {
    nodeId: root.root.nodeId,
    selector: request.selector,
  });
  if (!found.nodeId) {
    throw new BrowserDriverError('NOT_FOUND', `No element matches ${request.selector}`);
  }
  return { nodeId: found.nodeId };
}

export async function readDocument(
  client: CdpClient,
  request: ReadRequest,
  backendNodeIdForRef: (ref: string) => number,
): Promise<string> {
  const outer = await client.send<{ outerHTML: string }>(
    'DOM.getOuterHTML',
    await readTarget(client, request, backendNodeIdForRef),
  );
  return request.format === 'html' ? outer.outerHTML : toText(outer.outerHTML);
}
