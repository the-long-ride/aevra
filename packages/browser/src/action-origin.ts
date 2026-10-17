import { BrowserDriverError } from './driver.js';
import { classifyOrigin, type OriginPolicyConfig } from './origin-policy.js';

export function assertActionOrigin(
  url: string,
  expectedUrl?: string,
  policy?: Partial<OriginPolicyConfig>,
) {
  let matches = false;
  try {
    matches = !expectedUrl || new URL(url).origin === new URL(expectedUrl).origin;
  } catch {
    /* refuse malformed URLs */
  }
  const liveClass = classifyOrigin(url, policy);
  const upgraded =
    expectedUrl && classifyOrigin(expectedUrl, policy) === 'NORMAL' && liveClass === 'SENSITIVE';
  if (!matches || upgraded || liveClass === 'BLOCKED') {
    throw new BrowserDriverError(
      'BROWSER_ORIGIN_BLOCKED',
      'The live tab changed origin or is protected',
    );
  }
}

export function validateDebuggerUrl(value: string, port: number) {
  const url = new URL(value);
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    Number(url.port || 80) !== port ||
    url.username ||
    url.password
  ) {
    throw new BrowserDriverError(
      'BROWSER_ORIGIN_BLOCKED',
      'CDP debugger URL must use the configured loopback endpoint',
    );
  }
  return value;
}

export interface BrowserReadGuard {
  expectedUrl?: string;
  originPolicy?: Partial<OriginPolicyConfig>;
}

export function assertReadOrigin(url: string, guard: BrowserReadGuard, mode?: string) {
  assertActionOrigin(url, guard.expectedUrl, guard.originPolicy);
  if (
    (guard.expectedUrl && url !== guard.expectedUrl) ||
    (mode === 'vision' && classifyOrigin(url, guard.originPolicy) !== 'NORMAL')
  ) {
    throw new BrowserDriverError(
      'BROWSER_ORIGIN_BLOCKED',
      'The document changed during a browser read or cannot be captured',
    );
  }
}
