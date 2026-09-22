import { attributesToElement } from './cdp-ax.js';
import { CdpClient } from './cdp-client.js';
import { BrowserDriverError } from './driver.js';
import { isCredentialField } from './dom-snapshot.js';

export interface CdpActionTarget {
  backendNodeId: number;
  credential: boolean;
}

export async function resolveCdpSelector(
  client: CdpClient,
  selector: string,
): Promise<CdpActionTarget> {
  const document = await client.send<{ root: { nodeId: number } }>('DOM.getDocument', {
    depth: 0,
    pierce: true,
  });
  let found: { nodeId: number };
  try {
    found = await client.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector,
    });
  } catch (error) {
    throw new BrowserDriverError('INVALID_REQUEST', String((error as Error).message));
  }
  if (!found.nodeId) {
    throw new BrowserDriverError('NOT_FOUND', `No element matches ${selector}`);
  }
  const described = await client.send<{
    node: { backendNodeId?: number; attributes?: string[] };
  }>('DOM.describeNode', { nodeId: found.nodeId });
  const backendNodeId = Number(described.node.backendNodeId);
  if (!Number.isInteger(backendNodeId) || backendNodeId <= 0) {
    throw new BrowserDriverError('NOT_FOUND', `No element matches ${selector}`);
  }
  return {
    backendNodeId,
    credential: isCredentialField(attributesToElement(described.node.attributes ?? [])),
  };
}

export async function cdpBoxForBackend(
  client: CdpClient,
  backendNodeId: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const result = await client.send<{
    model: { content: number[]; width: number; height: number };
  }>('DOM.getBoxModel', { backendNodeId });
  const [x1, y1, , , x3, y3] = result.model.content;
  return {
    x: Number(x1),
    y: Number(y1),
    width: Number(x3) - Number(x1),
    height: Number(y3) - Number(y1),
  };
}

export async function clearFocusedCdpField(client: CdpClient): Promise<void> {
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    commands: ['SelectAll'],
  });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' });
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace' });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace' });
}

export async function cdpCenterForBackend(
  client: CdpClient,
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  const box = await cdpBoxForBackend(client, backendNodeId);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function clickCdpPoint(
  client: CdpClient,
  point: { x: number; y: number },
): Promise<void> {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await client.send('Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
    });
  }
}
