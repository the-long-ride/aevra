import type {
  BrowserActionInput,
  BrowserLogEntry,
  BrowserTabInfo,
} from '../../../packages/protocol/src/browser.js';
import type { NavigateResult } from '../../../packages/browser/src/driver.js';
import type { ExtensionBridge } from '../../../packages/browser/src/extension-bridge.js';
import type { SnapshotElementLike } from '../../../packages/browser/src/dom-snapshot.js';
import {
  applyPageAction,
  installConsoleCapture,
  installConsoleRelay,
  readDevicePixelRatio,
  serializePage,
} from './content.js';

const MAX_LOGS = 500;
const NAVIGATE_TIMEOUT_MS = 30_000;
const IDLE_SETTLE_MS = 500;

const consoleLogs: BrowserLogEntry[] = [];

export function recordConsoleLog(text: string, level = 'log'): void {
  consoleLogs.push({ at: new Date().toISOString(), kind: 'console', level, text });
  if (consoleLogs.length > MAX_LOGS) consoleLogs.splice(0, consoleLogs.length - MAX_LOGS);
}

/** Test seam: the buffer is module state that survives between cases. */
export function clearConsoleLogs(): void {
  consoleLogs.length = 0;
}

async function activeTabId(tabId?: string): Promise<number> {
  if (tabId) return Number(tabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw Object.assign(new Error('No active tab'), { code: 'NOT_FOUND' });
  return tab.id;
}

/**
 * Injects by function reference rather than by file: Chrome serializes the
 * function source into the page. That keeps the page agent an ordinary
 * exported function, which is what makes it testable under jsdom.
 */
async function inject<T>(
  tabId: number,
  func: (...args: any[]) => T,
  args: any[],
  world?: 'MAIN' | 'ISOLATED',
): Promise<T> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    ...(world ? { world } : {}),
  });
  return (await result?.result) as T;
}

/**
 * Console capture needs both worlds. The page's `console` object only exists in
 * the main world, and `chrome.runtime` only in the isolated one, so the capture
 * patches console and posts, and the relay listens and forwards. Both are
 * idempotent, so re-injecting on every snapshot and navigation is how capture
 * survives a page load without a persistent content script.
 */
async function ensureConsoleCapture(tabId: number): Promise<void> {
  try {
    await inject(tabId, installConsoleRelay, []);
    await inject(tabId, installConsoleCapture, [], 'MAIN');
  } catch {
    // A page that refuses injection - a restricted origin, a tab that closed -
    // simply yields no console logs. It must not fail the operation that asked.
  }
}

/**
 * Waits for the tab to finish loading, but never forever: a navigation that
 * never reports `complete` (a download, a blocked request, a hung server) would
 * otherwise leave the command pending until the worker's own timeout, with no
 * explanation.
 */
function whenLoaded(id: number, timeoutMs = NAVIGATE_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const finish = (loaded: boolean) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(loaded);
    };
    const listener = (updatedId: number, info: { status?: string }) => {
      if (updatedId === id && info.status === 'complete') finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

export function createChromeBridge(): ExtensionBridge {
  return {
    async listTabs(): Promise<BrowserTabInfo[]> {
      const tabs = await chrome.tabs.query({});
      // originClass is always NORMAL here: the worker reclassifies every origin.
      // The extension is deliberately not a policy authority.
      return tabs
        .filter((tab) => tab.id !== undefined)
        .map((tab) => ({
          tabId: String(tab.id),
          url: tab.url ?? '',
          title: tab.title ?? '',
          active: tab.active === true,
          originClass: 'NORMAL' as const,
        }));
    },

    async serialize(tabId?: string): Promise<SnapshotElementLike> {
      const id = await activeTabId(tabId);
      await ensureConsoleCapture(id);
      return inject(id, serializePage, [], 'ISOLATED');
    },

    async devicePixelRatio(tabId?: string): Promise<number> {
      const ratio = await inject(await activeTabId(tabId), readDevicePixelRatio, []).catch(() => 1);
      return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    },

    async apply(action: BrowserActionInput, elementId: string | null, tabId?: string) {
      const id = await activeTabId(tabId);
      const outcome = await inject(id, applyPageAction, [action, elementId], 'ISOLATED');
      return outcome?.ok === true
        ? { ok: true }
        : { ok: false, code: String(outcome?.code ?? 'BROWSER_UNAVAILABLE') };
    },

    async captureVisible(tabId?: string): Promise<string> {
      // Chrome can only capture the currently visible tab. Shared mode must not
      // activate a background target behind the user's back, so a named inactive
      // tab is an explicit unsupported case rather than an activation side effect.
      const id = await activeTabId(tabId);
      const tab = await chrome.tabs.get(id);
      if (tabId && tab.active !== true) {
        throw Object.assign(
          new Error('Extension vision capture requires the target tab to already be active'),
          { code: 'BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB' },
        );
      }
      return chrome.tabs.captureVisibleTab(tab.windowId as number, { format: 'png' });
    },

    async navigate(
      url: string,
      waitUntil: 'load' | 'idle',
      tabId?: string,
    ): Promise<NavigateResult> {
      const id = await activeTabId(tabId);
      await chrome.tabs.update(id, { url });
      await whenLoaded(id);
      if (waitUntil === 'idle') {
        await new Promise((resolve) => setTimeout(resolve, IDLE_SETTLE_MS));
      }
      // A load replaces the page's console, so capture is re-established here
      // rather than only on the next snapshot.
      await ensureConsoleCapture(id);
      const tab = await chrome.tabs.get(id);
      return {
        tabId: String(id),
        url: tab.url ?? url,
        status: null,
        redirected: (tab.url ?? url) !== url,
      };
    },

    async logs(kind: 'console' | 'network', limit: number): Promise<BrowserLogEntry[]> {
      // Network logs come from the CDP transport; the conformance suite tolerates
      // an empty list here rather than pretending this transport has them.
      if (kind === 'network') return [];
      return consoleLogs.slice(-Math.max(1, limit));
    },
  };
}
