import type { ApprovalItem, OauthRequestItem } from '@aevra/admin-contracts';

export interface RequestAnnouncement {
  title: string;
  body: string;
}

const seenApprovals = new Set<string>();
const seenOauth = new Set<string>();

export function collectRequestAnnouncements(
  approvals: readonly ApprovalItem[],
  oauthRequests: readonly OauthRequestItem[],
  approvalIds: Set<string>,
  oauthIds: Set<string>,
): RequestAnnouncement[] {
  const announcements: RequestAnnouncement[] = [];
  const pending = approvals.filter((item) => item.state === 'PENDING');

  for (const item of pending) {
    const id = String(item.id);
    if (approvalIds.has(id)) continue;
    approvalIds.add(id);
    const presentation = item.presentation ?? {};
    const title = presentation.title ?? 'Aevra approval request';
    const details = [
      presentation.action ?? item.operation.family,
      presentation.target,
      presentation.preview,
    ]
      .filter(Boolean)
      .join(' · ');
    announcements.push({
      title: `Aevra: ${title}`,
      body: `${item.actor ?? 'Remote AI'}: ${details}`,
    });
  }

  for (const item of oauthRequests) {
    const id = String(item.id);
    if (oauthIds.has(id)) continue;
    oauthIds.add(id);
    const client = item.clientName ?? item.clientId ?? 'Remote AI';
    const scopes = (item.requestedScopes ?? item.scopes ?? []).join(', ') || 'mcp';
    announcements.push({
      title: 'Aevra: OAuth connection request',
      body: `${client} wants to connect · scopes: ${scopes}`,
    });
  }

  const liveApprovals = new Set(pending.map((item) => String(item.id)));
  const liveOauth = new Set(oauthRequests.map((item) => String(item.id)));
  for (const id of approvalIds) {
    if (!liveApprovals.has(id)) approvalIds.delete(id);
  }
  for (const id of oauthIds) {
    if (!liveOauth.has(id)) oauthIds.delete(id);
  }

  return announcements;
}

export function announceNewRequests(
  approvals: readonly ApprovalItem[],
  oauthRequests: readonly OauthRequestItem[],
) {
  const announcements = collectRequestAnnouncements(
    approvals,
    oauthRequests,
    seenApprovals,
    seenOauth,
  );
  if (
    typeof window === 'undefined' ||
    !window.Notification ||
    window.Notification.permission !== 'granted'
  ) {
    return;
  }

  for (const announcement of announcements) {
    try {
      new window.Notification(announcement.title, {
        body: announcement.body,
        tag: `aevra-${announcement.title}-${announcement.body.slice(0, 80)}`,
      });
    } catch {
      // Browser notification failures never block request polling.
    }
  }
}
