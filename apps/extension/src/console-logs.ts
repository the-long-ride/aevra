import type { BrowserLogEntry } from '../../../packages/protocol/src/browser.js';
const MAX_LOGS = 500;
const consoleLogs: Array<{ tabId: number; documentId: string; entry: BrowserLogEntry }> = [];

export function recordConsoleLog(
  text: string,
  level = 'log',
  source?: { tabId: number; documentId: string },
): void {
  if (!source?.documentId || !Number.isInteger(source.tabId)) return;
  consoleLogs.push({
    ...source,
    entry: { at: new Date().toISOString(), kind: 'console', level, text },
  });
  if (consoleLogs.length > MAX_LOGS) consoleLogs.splice(0, consoleLogs.length - MAX_LOGS);
}

/** Test seam: the buffer is module state that survives between cases. */
export function clearConsoleLogs(tabId?: number): void {
  if (tabId === undefined) consoleLogs.length = 0;
  else
    for (let index = consoleLogs.length - 1; index >= 0; index--)
      if (consoleLogs[index]!.tabId === tabId) consoleLogs.splice(index, 1);
}

export async function readConsoleLogs(id: number, limit: number): Promise<BrowserLogEntry[]> {
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] },
    world: 'ISOLATED',
    func: () => undefined,
  });
  if (!frame?.documentId) return [];
  return consoleLogs
    .filter((row) => row.tabId === id && row.documentId === frame.documentId)
    .slice(-Math.max(1, limit))
    .map((row) => ({ ...row.entry }));
}
