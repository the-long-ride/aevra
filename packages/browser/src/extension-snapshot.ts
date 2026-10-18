import type { BrowserBox, BrowserSnapshotResult } from '../../protocol/src/browser.js';
import { classifyOrigin } from './origin-policy.js';
import { buildSnapshot, RefRegistry, type SnapshotElementLike } from './dom-snapshot.js';
import { boundedSnapshotAnnotations } from './snapshot-annotations.js';
import type { CaptureProgress, ExtensionBridge } from './extension-bridge.js';

function scaleBox(box: BrowserBox, scale: number): BrowserBox {
  return {
    x: box.x * scale,
    y: box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

export async function extensionSnapshot(
  registry: RefRegistry,
  rememberScale: (registry: RefRegistry, tabId: string, scale: number) => void,
  bridge: ExtensionBridge,
  params: Record<string, any>,
  onProgress?: (progress: CaptureProgress) => void,
  isCancelled?: () => boolean,
): Promise<BrowserSnapshotResult> {
  const tabs = await bridge.listTabs();
  const tab = params.tabId
    ? tabs.find((entry) => entry.tabId === params.tabId)
    : tabs.find((entry) => entry.active);
  // Chrome's composited screenshot does not need a DOM tree. A loading page
  // may briefly have no body, and a canvas game can make DOM injection slow.
  // Neither may prevent the image from reaching the caller.
  const boundedAnnotations = () =>
    boundedSnapshotAnnotations(() => bridge.serialize(params.tabId), isCancelled);
  const capture =
    params.mode === 'vision'
      ? await bridge.captureVisible(params.tabId, onProgress, boundedAnnotations, isCancelled)
      : null;
  let root: SnapshotElementLike | null;
  if (capture) {
    root =
      'annotationRoot' in capture ? (capture.annotationRoot ?? null) : await boundedAnnotations();
  } else {
    root = await bridge.serialize(params.tabId);
  }
  // Each snapshot takes the next version, which is what makes an older ref
  // stale rather than silently rebound to a different element.
  registry.documentId = root?.documentId;
  const built = registry.record(
    root
      ? buildSnapshot(root, {
          version: registry.version() + 1,
          maxNodes: Number(params.maxNodes ?? 400),
        })
      : { version: registry.version() + 1, nodes: [], elements: [], truncated: false },
  );
  const base = {
    tabId: tab?.tabId ?? '',
    url: tab?.url ?? '',
    // Fail closed: an unresolved tab has no url, and classifyOrigin('') is BLOCKED.
    originClass: tab?.originClass ?? classifyOrigin(tab?.url ?? ''),
    snapshotVersion: registry.version(),
  };
  if (capture) {
    // The screenshot is bounded to fit the transport, so its scale is whatever
    // the capture settled on, while every box is in CSS pixels. Scaling the
    // boxes into the image's own space is what lets a model point at what it
    // sees; the ratio travels with the result and is remembered for the
    // coordinate clicks that follow.
    const { devicePixelRatio } = capture;
    rememberScale(registry, base.tabId, devicePixelRatio);
    return {
      ...base,
      mode: 'vision',
      imageDataUri: capture.imageDataUri,
      devicePixelRatio,
      imageWidth: capture.imageWidth,
      imageHeight: capture.imageHeight,
      viewport: capture.viewport,
      boxes: built.nodes
        .filter((node) => node.box)
        .map((node) => ({
          ref: node.ref,
          label: node.name,
          box: scaleBox(node.box!, devicePixelRatio),
        })),
    };
  }
  return { ...base, mode: 'a11y', nodes: built.nodes, truncated: built.truncated };
}
