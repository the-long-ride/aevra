import { useCallback, useRef, type RefCallback } from 'react';

/**
 * One stack for every modal layer (common dialog, `.modal` modals, the requests
 * drawer). While a blocking layer is open the page cannot scroll, and everything
 * outside the top blocking layer is `inert`: not clickable, focusable or tabbable.
 * Closing the top layer hands interaction back to the layer below it; closing the
 * last one restores the body styles and inert attributes exactly as they were.
 *
 * A non-blocking layer (the floating approval card) never locks or inerts the page.
 * Opened above a blocking layer it stays interactive; under one it goes inert.
 */

/** Announcement regions stay live above any modal. */
const EXEMPT_SELECTOR = '.toast-stack, [data-modal-layer-exempt]';
const TOP_ATTRIBUTE = 'data-modal-layer-top';
const STACKED_ATTRIBUTE = 'data-modal-stacked';

interface Layer {
  element: HTMLElement;
  blocking: boolean;
}

interface SavedBody {
  overflow: string;
  paddingRight: string;
}

const layers: Layer[] = [];
/** Elements this module made inert; anything inert before stays untouched. */
const madeInert = new Set<Element>();
let savedBody: SavedBody | null = null;

/** The largest subtrees of <body> that contain none of `keep`. */
function backgroundOf(keep: HTMLElement[]): Set<Element> {
  const background = new Set<Element>();
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (keep.includes(child as HTMLElement) || child.matches(EXEMPT_SELECTOR)) continue;
      if (keep.some((element) => child.contains(element))) visit(child);
      else background.add(child);
    }
  };
  visit(document.body);
  return background;
}

function lockBody() {
  const body = document.body;
  const viewport = document.documentElement.clientWidth;
  // jsdom and overlay scrollbars report no layout width: nothing to compensate.
  const scrollbar = viewport > 0 ? Math.max(0, window.innerWidth - viewport) : 0;
  savedBody = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  if (scrollbar > 0) {
    const padding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${padding + scrollbar}px`;
  }
  body.style.overflow = 'hidden';
}

function unlockBody(saved: SavedBody) {
  document.body.style.overflow = saved.overflow;
  document.body.style.paddingRight = saved.paddingRight;
  if (!document.body.getAttribute('style')) document.body.removeAttribute('style');
}

function sync() {
  const attached = layers.filter((layer) => document.body.contains(layer.element));
  let blockingIndex = -1;
  attached.forEach((layer, index) => {
    if (layer.blocking) blockingIndex = index;
  });
  const keep = blockingIndex < 0 ? [] : attached.slice(blockingIndex).map((layer) => layer.element);
  const background = keep.length ? backgroundOf(keep) : new Set<Element>();
  for (const element of madeInert) {
    if (background.has(element)) continue;
    element.removeAttribute('inert');
    madeInert.delete(element);
  }
  for (const element of background) {
    if (madeInert.has(element) || element.hasAttribute('inert')) continue;
    element.setAttribute('inert', '');
    madeInert.add(element);
  }
  const top = topModalLayer();
  for (const layer of layers) layer.element.toggleAttribute(TOP_ATTRIBUTE, layer.element === top);
  // Only a layer stacked on another needs raising (CSS); a lone layer keeps its own z-index.
  document.body.toggleAttribute(STACKED_ATTRIBUTE, layers.length > 1);
  if (keep.length && !savedBody) lockBody();
  if (!keep.length && savedBody) {
    unlockBody(savedBody);
    savedBody = null;
  }
}

/** Push a modal layer; the returned function removes exactly this registration. */
function pushModalLayer(element: HTMLElement, blocking = true): () => void {
  const layer: Layer = { element, blocking };
  layers.push(layer);
  sync();
  return () => {
    const index = layers.indexOf(layer);
    if (index < 0) return;
    layers.splice(index, 1);
    if (!layers.some((other) => other.element === element)) element.removeAttribute(TOP_ATTRIBUTE);
    sync();
  };
}

/** The element of the most recently opened layer, if any. */
export function topModalLayer(): HTMLElement | null {
  return layers.at(-1)?.element ?? null;
}

/** True when `node` belongs to the top layer, or when no layer is open. */
function isTopModalLayer(node: Node | null): boolean {
  const top = topModalLayer();
  if (!top) return true;
  return node !== null && top.contains(node);
}

/**
 * Register the element the returned `ref` is attached to (the layer's backdrop)
 * as a modal layer while it is mounted and `active`. `isTop()` lets the layer's
 * own Escape / Tab handling ignore keys meant for a layer stacked above it.
 */
export function useModalLayer(
  active = true,
  { blocking = true }: { blocking?: boolean } = {},
): {
  ref: RefCallback<HTMLElement>;
  isTop(): boolean;
} {
  const node = useRef<HTMLElement | null>(null);
  const ref = useCallback(
    (element: HTMLElement | null) => {
      node.current = element;
      if (!element || !active) return undefined;
      const release = pushModalLayer(element, blocking);
      return () => {
        node.current = null;
        release();
      };
    },
    [active, blocking],
  );
  const isTop = useCallback(() => isTopModalLayer(node.current), []);
  return { ref, isTop };
}
