import { createHmac } from 'node:crypto';

const BROWSER_TOKEN_KEY_LABEL = 'aevra:browser:extension-token:v1';

/**
 * Domain-separates the extension token key from the IPC envelope MAC key. Both
 * sides derive it from the same worker secret, so an extension token that leaks
 * never yields the key that signs operation envelopes.
 */
export function deriveBrowserTokenKey(secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(BROWSER_TOKEN_KEY_LABEL).digest();
}
