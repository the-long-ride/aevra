import type { BrowserBox, BrowserSnapshotNode } from '../../protocol/src/browser.js';

export interface SnapshotElementLike {
  tagName: string;
  attributes: Record<string, string>;
  children: SnapshotElementLike[];
  textContent: string;
  value?: string;
  box?: BrowserBox;
}

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
const NAMED_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'legend', 'option']);
const CREDENTIAL_AUTOCOMPLETE = /^(one-time-code|current-password|new-password|cc-[a-z-]+)$/i;
const CREDENTIAL_HINT = /(pass(word|wd)?|otp|one.?time|cvv|cvc|csc|card.?number|cardnum|iban|ssn)/i;

function attr(element: SnapshotElementLike, name: string): string {
  return element.attributes[name] ?? '';
}

export function isCredentialField(element: SnapshotElementLike): boolean {
  if (element.tagName.toLowerCase() !== 'input') return false;
  if (attr(element, 'type').toLowerCase() === 'password') return true;
  if (CREDENTIAL_AUTOCOMPLETE.test(attr(element, 'autocomplete'))) return true;
  const hints = ['name', 'id', 'aria-label', 'placeholder']
    .map((key) => attr(element, key))
    .join(' ');
  return CREDENTIAL_HINT.test(hints);
}

export function roleOf(element: SnapshotElementLike): string {
  const explicit = attr(element, 'role');
  if (explicit) return explicit.toLowerCase();
  const tag = element.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const type = attr(element, 'type').toLowerCase() || 'text';
    if (type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button') {
      return type === 'submit' ? 'button' : type;
    }
    return 'textbox';
  }
  if (/^h[1-6]$/.test(tag)) return 'heading';
  return tag;
}

export function accessibleName(element: SnapshotElementLike): string {
  const labelled = attr(element, 'aria-label') || attr(element, 'title') || attr(element, 'alt');
  if (labelled) return labelled.trim();
  const placeholder = attr(element, 'placeholder');
  if (placeholder) return placeholder.trim();
  return element.textContent.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function isHidden(element: SnapshotElementLike): boolean {
  if ('hidden' in element.attributes) return true;
  if (attr(element, 'aria-hidden') === 'true') return true;
  return /display:\s*none|visibility:\s*hidden/i.test(attr(element, 'style'));
}

function isInteresting(element: SnapshotElementLike): boolean {
  const tag = element.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag) || NAMED_TAGS.has(tag)) return true;
  return Boolean(attr(element, 'role'));
}

export function makeRef(version: number, index: number): string {
  return `ref_${version}_${index}`;
}

export function parseRef(ref: string): { version: number; index: number } {
  const match = /^ref_(\d+)_(\d+)$/.exec(String(ref ?? ''));
  if (!match) return { version: -1, index: -1 };
  return { version: Number(match[1]), index: Number(match[2]) };
}

export interface SnapshotResult {
  version: number;
  nodes: BrowserSnapshotNode[];
  elements: SnapshotElementLike[];
  truncated: boolean;
}

export function buildSnapshot(
  root: SnapshotElementLike,
  options: { version: number; maxNodes: number },
): SnapshotResult {
  const nodes: BrowserSnapshotNode[] = [];
  const elements: SnapshotElementLike[] = [];
  let truncated = false;

  const visit = (element: SnapshotElementLike): void => {
    if (nodes.length >= options.maxNodes) {
      truncated = true;
      return;
    }
    if (isHidden(element)) return;
    if (isInteresting(element)) {
      const index = elements.length;
      elements.push(element);
      const node: BrowserSnapshotNode = {
        ref: makeRef(options.version, index),
        role: roleOf(element),
        name: accessibleName(element),
      };
      if (element.value !== undefined) node.value = element.value;
      if ('disabled' in element.attributes) node.disabled = true;
      if (isCredentialField(element)) node.credentialField = true;
      if (element.box) node.box = element.box;
      nodes.push(node);
    }
    for (const child of element.children) visit(child);
  };

  visit(root);
  return { version: options.version, nodes, elements, truncated };
}

export class RefRegistry {
  private currentVersion = 0;
  private elements: SnapshotElementLike[] = [];
  private credential = new Set<string>();

  version(): number {
    return this.currentVersion;
  }

  record(snapshot: SnapshotResult): SnapshotResult {
    this.currentVersion = snapshot.version;
    this.elements = snapshot.elements;
    this.credential = new Set(
      snapshot.nodes.filter((node) => node.credentialField).map((node) => node.ref),
    );
    return snapshot;
  }

  has(ref: string): boolean {
    const parsed = parseRef(ref);
    return parsed.version === this.currentVersion && Boolean(this.elements[parsed.index]);
  }

  isCredential(ref: string): boolean {
    return this.credential.has(ref);
  }

  resolve(ref: string): SnapshotElementLike {
    const parsed = parseRef(ref);
    if (parsed.version !== this.currentVersion) {
      throw new Error(`BROWSER_REF_STALE: ${ref} is from snapshot ${parsed.version}`);
    }
    const element = this.elements[parsed.index];
    if (!element) throw new Error(`BROWSER_REF_STALE: ${ref} no longer resolves`);
    return element;
  }
}
