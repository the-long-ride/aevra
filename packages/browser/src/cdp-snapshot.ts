import type { BrowserSnapshotResult } from '../../protocol/src/browser.js';
import type { SnapshotRequest } from './driver.js';
import type { CdpTargetState } from './cdp-target-session.js';
import { guardCdpRead } from './cdp-read-policy.js';
import {
  axTreeToNodes,
  markCredentialFields,
  snapshotDocumentWithRetry,
  type AxNode,
} from './cdp-ax.js';
import { classifyOrigin } from './origin-policy.js';
import { captureViewport, scaledBoxes } from './cdp-vision.js';
import { cdpBoxForBackend } from './cdp-selector.js';

export async function snapshotCdp(
  state: CdpTargetState,
  request: SnapshotRequest,
  version: number,
  currentUrl: () => Promise<string>,
): Promise<BrowserSnapshotResult> {
  const finishRead = await guardCdpRead(state, () => currentUrl(), request, request.mode);
  state.version = version;
  const { url, nodes } = await snapshotDocumentWithRetry(
    () => currentUrl(),
    () => state.client.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree'),
  );
  const mapping = axTreeToNodes(nodes, state.version, request.maxNodes);
  state.backendIds = mapping.backendIds;

  const attributesByIndex = new Map<number, string[]>();
  for (let index = 0; index < mapping.backendIds.length; index += 1) {
    try {
      const described = await state.client.send<{ node: { attributes?: string[] } }>(
        'DOM.describeNode',
        { backendNodeId: mapping.backendIds[index] },
      );
      attributesByIndex.set(index, described.node.attributes ?? []);
    } catch {
      attributesByIndex.set(index, []);
    }
  }
  markCredentialFields(mapping.nodes, attributesByIndex);
  state.credentialRefs = new Set(
    mapping.nodes.filter((node) => node.credentialField).map((node) => node.ref),
  );

  const base = {
    tabId: state.id,
    url,
    originClass: classifyOrigin(url),
    snapshotVersion: state.version,
    mode: request.mode,
    nodes: mapping.nodes,
    truncated: mapping.truncated,
  };
  if (request.mode === 'a11y') {
    await finishRead();
    return base;
  }
  const capture = await captureViewport(state.client);
  // Kept so the coordinate clicks that follow can be put back in CSS pixels.
  state.visionScale = capture.devicePixelRatio;
  const boxes = await scaledBoxes(
    mapping.nodes,
    (index) => cdpBoxForBackend(state.client, Number(state.backendIds[index])),
    capture.devicePixelRatio,
  );
  await finishRead();
  return { ...base, ...capture, boxes };
}
