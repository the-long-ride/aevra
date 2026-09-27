import { AevraToolError } from './errors.js';

export interface BrowserApprovalStatus {
  connected?: boolean;
  attachmentId?: string | null;
  transport?: string | null;
  activePairingId?: string | null;
  activeProfileId?: string | null;
}

export function browserApprovalBinding(
  status: BrowserApprovalStatus,
  tabId: string | undefined,
  url: string,
) {
  if (!status.connected || !status.attachmentId)
    throw new AevraToolError('BROWSER_NOT_CONNECTED', 'Browser attachment is unavailable');
  return {
    attachmentId: status.attachmentId,
    transport: status.transport ?? null,
    pairingId: status.activePairingId ?? null,
    profileId: status.activeProfileId ?? null,
    tabId,
    url,
  };
}
