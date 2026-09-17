import { mintExtensionToken } from '../../security/src/extension-token.js';
import { RefRegistry, type SnapshotElementLike } from '../src/dom-snapshot.js';
import { handleExtensionCommand, type ExtensionBridge } from '../src/extension-bridge.js';
import { ExtensionDriver } from '../src/extension-driver.js';
import { ExtensionServer } from '../src/extension-server.js';
import { classifyOrigin } from '../src/origin-policy.js';
import { runDriverConformance } from './conformance.js';
import { connectFakeExtension } from './fake-extension.js';
import { FIXTURE_PAGE } from './fixtures.js';

const secret = Buffer.from('d'.repeat(64), 'hex');
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';

function textOf(node: SnapshotElementLike): string {
  const own = String(node.textContent ?? '').trim();
  return [own, ...(node.children ?? []).map(textOf)].filter(Boolean).join('\n');
}

/**
 * Stands in for the MV3 service worker's chrome.* surface only. Everything
 * above it - refs, staleness, the credential refusal, read scoping - runs the
 * real `handleExtensionCommand`, so this suite measures the shipped code path
 * rather than a lookalike.
 */
function chromeBridge(url: () => string, setUrl: (next: string) => void): ExtensionBridge {
  return {
    async listTabs() {
      return [
        {
          tabId: 'tab-1',
          url: url(),
          title: 'Invoices',
          active: true,
          originClass: classifyOrigin(url()),
        },
      ];
    },
    async serialize() {
      return FIXTURE_PAGE;
    },
    async devicePixelRatio() {
      // A HiDPI display, so the box scaling is exercised rather than a no-op.
      return 2;
    },
    async apply(action) {
      // Models the content script: wait_for polls to its deadline in the page.
      if (action.op === 'wait_for') {
        const deadline = Date.now() + action.timeoutMs;
        const page = textOf(FIXTURE_PAGE);
        while (Date.now() < deadline) {
          if (!action.text || page.includes(action.text)) return { ok: true };
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return { ok: false, code: 'BROWSER_TIMEOUT' };
      }
      return { ok: true };
    },
    async captureVisible() {
      return 'data:image/png;base64,iVBORw0KGgo=';
    },
    async navigate(next) {
      setUrl(next);
      return { tabId: 'tab-1', url: next, status: 200, redirected: false };
    },
    async logs() {
      return [{ at: new Date().toISOString(), kind: 'console', level: 'log', text: 'ready' }];
    },
  };
}

runDriverConformance('ExtensionDriver', async () => {
  const server = new ExtensionServer({ secret, extensionId, epoch: () => 1 });
  const address = await server.start({ port: 0 });
  const peer = await connectFakeExtension(address.url, extensionId, {
    token: mintExtensionToken(secret, {
      extensionId,
      epoch: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  });

  let url = 'about:blank';
  const registry = new RefRegistry();
  const bridge = chromeBridge(
    () => url,
    (next) => {
      url = next;
    },
  );
  peer.onCommand((command) =>
    handleExtensionCommand(registry, bridge, {
      op: command.op as never,
      params: command.params ?? {},
    }),
  );

  // The auth frame is in flight; the driver must not call before it lands.
  for (let attempt = 0; attempt < 50 && !server.peer(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const driver = new ExtensionDriver(server);
  return {
    driver,
    connectOptions: { transport: 'extension' },
    startUrl: 'https://example.com/invoices',
    buttonName: 'New invoice',
    textFieldRole: 'textbox',
    scopedSelector: 'h1',
    scopedExpectation: /Invoices/,
    teardown: async () => {
      await driver.disconnect();
      peer.destroy();
      await server.stop();
    },
  };
});
