import { createChromeBridge, recordConsoleLog } from './bridge.js';
import { ExtensionRpc } from './rpc.js';

/**
 * Entry point: constructs the bridge and wires it to the browser's lifecycle.
 * All behaviour lives in `bridge.ts` and `rpc.ts`, which is what lets both be
 * tested; this file is the wiring those tests drive.
 */
export function startServiceWorker(): ExtensionRpc {
  const rpc = new ExtensionRpc(createChromeBridge());

  // MV3 evicts an idle service worker, so wake-up re-establishes the socket.
  chrome.runtime.onStartup.addListener(() => void rpc.connect());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    const url = changeInfo?.url ?? tab?.url ?? '';
    if (url.includes('127.0.0.1:47831') || url.includes('localhost:47831')) {
      void rpc.connect(true);
    }
  });
  chrome.runtime.onMessage.addListener(
    (
      message: { type?: string; text?: string; level?: string },
      _sender,
      sendResponse?: (response?: unknown) => void,
    ) => {
      if (message?.type === 'aevra:console') {
        recordConsoleLog(String(message.text ?? ''), String(message.level ?? 'log'));
      }
      if (message?.type === 'aevra:paired' || message?.type === 'aevra:connect') {
        void rpc.connect(true);
      }
      if (message?.type === 'aevra:disconnect') {
        rpc.disconnect();
      }
      if (message?.type === 'aevra:getStatus') {
        if (!rpc.isConnected()) {
          void rpc.connect();
        }
        sendResponse?.({ connected: rpc.isConnected() });
      }
    },
  );

  return rpc;
}

startServiceWorker();
