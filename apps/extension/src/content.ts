// Injected with chrome.scripting.executeScript({ func }), which serializes the
// function source and runs it in the page. That imposes one hard rule: every
// exported function must be entirely self-contained - no imports, no
// module-scope constants, no shared helpers - because nothing outside the
// function body survives serialization.
//
// The upside is that they are ordinary exported functions, so they run under
// jsdom in this package's own vitest project rather than being untestable.

export interface SerializedElement {
  elementId: string;
  tagName: string;
  attributes: Record<string, string>;
  children: SerializedElement[];
  textContent: string;
  value?: string;
  box?: { x: number; y: number; width: number; height: number };
}

export type ApplyOutcome = { ok: boolean; code?: string };

export function serializePage(): SerializedElement {
  const MAX_ELEMENTS = 5000;
  const CREDENTIAL_AUTOCOMPLETE = /^(one-time-code|current-password|new-password|cc-[a-z-]+)$/i;
  const CREDENTIAL_HINT =
    /(pass(word|wd)?|otp|one.?time|cvv|cvc|csc|card.?number|cardnum|iban|ssn)/i;
  const protectedValue = (element: Element): boolean => {
    if (!(element instanceof HTMLInputElement)) return false;
    if (element.type.toLowerCase() === 'password') return true;
    if (CREDENTIAL_AUTOCOMPLETE.test(element.getAttribute('autocomplete') ?? '')) return true;
    return CREDENTIAL_HINT.test(
      ['name', 'id', 'aria-label', 'placeholder']
        .map((name) => element.getAttribute(name) ?? '')
        .join(' '),
    );
  };
  let budget = MAX_ELEMENTS;
  type ElementRegistry = {
    ids: WeakMap<Element, string>;
    elements: Map<string, Element>;
    nextId: number;
  };
  const scope = window as unknown as { __aevraElementRegistry?: ElementRegistry };
  let registry = scope.__aevraElementRegistry;
  if (!registry) {
    registry = { ids: new WeakMap(), elements: new Map(), nextId: 1 };
    scope.__aevraElementRegistry = registry;
  }
  // Reverse lookup contains only nodes from the current snapshot. The WeakMap
  // may retain an opaque identity for a still-live node, but a detached node
  // cannot remain actionable merely because an older snapshot saw it.
  registry.elements.clear();

  const opaqueId = (element: Element): string => {
    let id = registry!.ids.get(element);
    if (!id) {
      id = `element_${registry!.nextId++}`;
      registry!.ids.set(element, id);
    }
    registry!.elements.set(id, element);
    return id;
  };

  const walk = (element: Element): SerializedElement => {
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes)) {
      attributes[attribute.name] = attribute.value;
    }

    const rect = element.getBoundingClientRect();
    const node: SerializedElement = {
      elementId: opaqueId(element),
      tagName: element.tagName.toLowerCase(),
      attributes,
      children: [],
      textContent: ((element as HTMLElement).innerText ?? element.textContent ?? '').slice(0, 400),
    };
    if (
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
      !protectedValue(element)
    ) {
      node.value = element.value;
    }
    if (rect.width > 0 && rect.height > 0) {
      node.box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    for (const child of Array.from(element.children)) {
      if (budget <= 0) break;
      budget -= 1;
      node.children.push(walk(child));
    }
    return node;
  };

  return walk(document.body);
}

/**
 * `chrome.tabs.captureVisibleTab` has no scale control, so its PNG comes back in
 * device pixels while every DOM box is in CSS pixels. Vision mode needs the
 * ratio to reconcile the two.
 */
export function readDevicePixelRatio(): number {
  const value = Number(window.devicePixelRatio);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Runs in the page's own world, where `console` is the object page scripts call.
 * It cannot reach `chrome.runtime` from there, so it hands each line to the
 * isolated-world relay through `postMessage`. Idempotent: repeated injection
 * must not stack wrappers and multiply every line.
 */
export function installConsoleCapture(): boolean {
  const scope = window as unknown as Record<string, unknown>;
  if (scope.__aevraConsoleCaptured) return false;
  scope.__aevraConsoleCaptured = true;

  const render = (value: unknown): string => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const target = console as unknown as Record<string, (...args: unknown[]) => void>;
    const original = target[level];
    if (typeof original !== 'function') continue;
    target[level] = (...args: unknown[]) => {
      try {
        window.postMessage(
          {
            source: 'aevra:console',
            level,
            text: args.map(render).join(' ').slice(0, 2000),
          },
          '*',
        );
      } catch {
        // Capture is never allowed to break the page it is observing.
      }
      original.apply(console, args);
    };
  }
  return true;
}

/**
 * Runs in the isolated world, where `chrome.runtime` exists. Forwards only
 * messages posted by this window, which excludes other frames but deliberately
 * claims nothing more: page scripts share the main world with the capture, so a
 * page can post this shape itself. Console entries are page-attested by nature
 * and travel to the model as untrusted content either way - there is no
 * boundary here to pretend otherwise about.
 */
export function installConsoleRelay(): boolean {
  const scope = window as unknown as Record<string, unknown>;
  if (scope.__aevraConsoleRelay) return false;
  scope.__aevraConsoleRelay = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source && event.source !== window) return;
    const data = event.data as { source?: string; level?: string; text?: string } | null;
    if (!data || data.source !== 'aevra:console') return;
    chrome.runtime.sendMessage({
      type: 'aevra:console',
      level: String(data.level ?? 'log'),
      text: String(data.text ?? ''),
    });
  });
  return true;
}

export function applyPageAction(
  action: Record<string, any>,
  elementId: string | null,
): ApplyOutcome | Promise<ApplyOutcome> {
  // Inlined rather than shared: a module-scope constant would not survive
  // function serialization into the page.
  const CREDENTIAL_AUTOCOMPLETE = /^(one-time-code|current-password|new-password|cc-[a-z-]+)$/i;
  const refusesTyping = (candidate: Element): boolean => {
    if (!(candidate instanceof HTMLInputElement)) return false;
    if (candidate.type.toLowerCase() === 'password') return true;
    return CREDENTIAL_AUTOCOMPLETE.test(candidate.getAttribute('autocomplete') ?? '');
  };

  type ElementRegistry = { elements: Map<string, Element> };
  const registry = (window as unknown as { __aevraElementRegistry?: ElementRegistry })
    .__aevraElementRegistry;
  let element = elementId === null ? null : (registry?.elements.get(elementId) ?? null);
  if (element && !element.isConnected) element = null;
  const selector = typeof action.selector === 'string' ? action.selector : '';
  if (!element && selector) {
    try {
      element = document.querySelector(selector);
    } catch {
      return { ok: false, code: 'INVALID_REQUEST' };
    }
  }

  if (action.op === 'press_key') {
    const target = document.activeElement ?? document.body;
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, { key: String(action.key), bubbles: true }));
    }
    return { ok: true };
  }

  if (action.op === 'wait_for') {
    const text = String(action.text ?? '');
    if (!selector && !text) return { ok: true };
    if (selector) {
      try {
        document.querySelector(selector);
      } catch {
        return { ok: false, code: 'INVALID_REQUEST' };
      }
    }
    // Polls to the deadline rather than checking once, so this transport agrees
    // with the CDP driver instead of failing the moment the target is not there.
    const deadline = Date.now() + Math.max(0, Number(action.timeoutMs ?? 5000));
    return new Promise<ApplyOutcome>((resolve) => {
      const check = () => {
        const body = document.body;
        const selectorReady = selector ? Boolean(document.querySelector(selector)) : false;
        const textReady =
          Boolean(text) && (body.innerText?.includes(text) || body.textContent?.includes(text));
        if (selectorReady || textReady) return resolve({ ok: true });
        if (Date.now() >= deadline) return resolve({ ok: false, code: 'BROWSER_TIMEOUT' });
        setTimeout(check, 50);
      };
      check();
    });
  }

  // Only a click that actually carries coordinates is a coordinate click. A
  // click whose element index no longer resolves is a stale ref, and must say
  // so rather than falling through and dispatching at NaN.
  const hasPoint = Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y));
  if (action.op === 'click' && element === null && hasPoint) {
    // Coordinates arrive in the screenshot's pixel space, which this transport
    // captures at the display's device pixel ratio. `elementFromPoint` wants CSS
    // pixels, so on a HiDPI display an unconverted click lands short of its
    // target by that ratio.
    const ratio = Number(window.devicePixelRatio);
    const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    const found =
      document.elementFromPoint?.(Number(action.x) / scale, Number(action.y) / scale) ?? null;
    if (!found) return { ok: false, code: 'NOT_FOUND' };
    (found as HTMLElement).click();
    return { ok: true };
  }

  if (!element) return { ok: false, code: 'NOT_FOUND' };

  if (action.op === 'click') {
    (element as HTMLElement).click();
    return { ok: true };
  }

  if (action.op === 'type') {
    // Second wall, behind the service worker's: a compromised worker still
    // cannot get a password typed into the page.
    if (refusesTyping(element)) {
      return { ok: false, code: 'BROWSER_CREDENTIAL_FIELD_REFUSED' };
    }
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    if (action.clear) field.value = '';
    field.value += String(action.text ?? '');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }

  if (action.op === 'scroll') {
    (element as HTMLElement).scrollBy?.(Number(action.dx ?? 0), Number(action.dy ?? 0));
    return { ok: true };
  }

  if (action.op === 'select') {
    const select = element as HTMLSelectElement;
    select.value = String(action.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }

  return { ok: false, code: 'INVALID_REQUEST' };
}
