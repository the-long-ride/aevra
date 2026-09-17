import { createChromeBridge, recordConsoleLog } from './bridge.js';
import { ExtensionRpc } from './rpc.js';

/**
 * Entry point: constructs the bridge and wires it to the browser's lifecycle.
 * All behaviour lives in `bridge.ts` and `rpc.ts`, which is what lets both be
 * tested; this file is the wiring those tests drive.
 */
export function startServiceWorker(): ExtensionRpc {
  const rpc = new ExtensionRpc(createChromeBridge());

  // MV3 evicts an idle service worker, so every wake-up re-establishes the socket.
  chrome.runtime.onStartup.addListener(() => void rpc.connect());
  chrome.runtime.onInstalled.addListener(() => void rpc.connect());
  chrome.tabs.onUpdated.addListener(() => void rpc.connect());
  chrome.runtime.onMessage.addListener(
    (message: { type?: string; text?: string; level?: string }) => {
      if (message?.type === 'aevra:console') {
        recordConsoleLog(String(message.text ?? ''), String(message.level ?? 'log'));
      }
      if (message?.type === 'aevra:paired') void rpc.connect();
    },
  );

  void rpc.connect();
  return rpc;
}

startServiceWorker();
