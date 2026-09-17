import { requestJson } from '../../services/api-client';

export interface BrowserExtensionState {
  extensionId: string | null;
  pairedAt: string | null;
}

export async function loadBrowserExtensionState(
  signal?: AbortSignal,
): Promise<BrowserExtensionState> {
  return requestJson<BrowserExtensionState>('/api/browser', signal ? { signal } : {});
}
