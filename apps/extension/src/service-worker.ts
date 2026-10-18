import { clearConsoleLogs, createChromeBridge, recordConsoleLog } from './bridge.js';
import { ExtensionRpc } from './rpc.js';
import { matchesPairingOrigin } from './pairing-response.js';

/**
 * Entry point: constructs the bridge and wires it to the browser's lifecycle.
 * All behaviour lives in `bridge.ts` and `rpc.ts`, which is what lets both be
 * tested; this file is the wiring those tests drive.
 */
export function startServiceWorker(): ExtensionRpc {
  const rpc = new ExtensionRpc(createChromeBridge());

  // MV3 evicts an idle service worker, so wake-up re-establishes the socket.
  chrome.runtime.onStartup.addListener(() => void rpc.connect());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' || changeInfo.url) clearConsoleLogs(tabId);
    const url = changeInfo?.url ?? tab?.url ?? '';
    void chrome.storage.local.get(['pairingOrigin', 'wsUrl']).then((saved) => {
      if (matchesPairingOrigin(url, saved)) void rpc.connect(true);
    });
  });
  chrome.runtime.onMessage.addListener(
    (
      message: { type?: string; text?: string; level?: string },
      sender,
      sendResponse?: (response?: unknown) => void,
    ) => {
      if (message?.type === 'aevra:console') {
        // Only Chrome's top-frame sender identity is authoritative; page payload is not.
        if (sender?.tab?.id !== undefined && sender.frameId === 0 && sender.documentId)
          recordConsoleLog(String(message.text ?? ''), String(message.level ?? 'log'), {
            tabId: sender.tab.id,
            documentId: sender.documentId,
          });
      }
      if (message?.type === 'aevra:paired' || message?.type === 'aevra:connect') {
        if (message?.type === 'aevra:paired') rpc.newPairing();
        else void rpc.connect(true);
      }
      if (message?.type === 'aevra:disconnect') {
        rpc.disconnect();
      }
      if (message?.type === 'aevra:getStatus') {
        if (!rpc.isConnected()) {
          void rpc.connect();
        }
        sendResponse?.({ connected: rpc.isConnected(), ...rpc.status() });
      }
    },
  );

  // A manual extension reload does not fire onStartup. Reconnect a saved
  // pairing when this worker is evaluated; unpaired profiles remain idle.
  void rpc.connect();

  return rpc;
}

startServiceWorker();
