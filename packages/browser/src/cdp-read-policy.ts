import type { CdpTargetState } from './cdp-target-session.js';
import { BrowserDriverError } from './driver.js';
import { assertReadOrigin } from './action-origin.js';
export async function guardCdpRead(
  state: CdpTargetState,
  currentUrl: () => Promise<string>,
  request: import('./action-origin.js').BrowserReadGuard,
  mode?: string,
) {
  const version = state.client.documentVersion;
  const url = await currentUrl();
  const guard = { ...request, expectedUrl: request.expectedUrl ?? url };
  assertReadOrigin(url, guard, mode);
  return async () => {
    assertReadOrigin(await currentUrl(), guard, mode);
    if (state.client.documentVersion !== version)
      throw new BrowserDriverError(
        'BROWSER_ORIGIN_BLOCKED',
        'Document navigated during browser read',
      );
  };
}
