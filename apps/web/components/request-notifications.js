import { toast } from './toast.js';

const seenApprovals = new Set();
const seenOauth = new Set();

function nativeNotification() {
  return typeof window !== 'undefined' ? window.Notification : undefined;
}

function notifyBrowser(title, body) {
  const NotificationApi = nativeNotification();
  if (!NotificationApi || NotificationApi.permission !== 'granted') return;
  try {
    new NotificationApi(title, {
      body,
      tag: `aevra-${title}-${body.slice(0, 80)}`,
    });
  } catch {
    // Browser notification failures do not block local UI state.
  }
}

export function notificationButtonLabel() {
  const NotificationApi = nativeNotification();
  if (!NotificationApi) return 'Browser notifications unavailable';
  if (NotificationApi.permission === 'granted') {
    return 'Browser notifications enabled';
  }
  if (NotificationApi.permission === 'denied') {
    return 'Browser notifications blocked';
  }
  return 'Enable browser notifications';
}

export async function requestNotificationPermission() {
  const NotificationApi = nativeNotification();
  if (!NotificationApi) return 'unsupported';
  const permission = await NotificationApi.requestPermission();
  toast(
    permission === 'granted'
      ? 'Browser notifications enabled'
      : 'Browser notifications were not enabled',
    permission === 'granted' ? 'success' : 'info',
  );
  return permission;
}

export function announceNewRequests(approvals, oauthRequests) {
  const pending = approvals.filter((item) => item.state === 'PENDING');
  for (const item of pending) {
    const id = String(item.id);
    if (seenApprovals.has(id)) continue;
    seenApprovals.add(id);
    const presentation = item.presentation ?? {};
    const title = presentation.title ?? 'Aevra approval request';
    const details = [
      presentation.action ?? item.operation?.family,
      presentation.target,
      presentation.preview,
    ]
      .filter(Boolean)
      .join(' · ');
    const body = `${item.actor ?? 'Remote AI'}: ${details}`;
    toast(`${title}: ${body}`, 'info', 7600);
    notifyBrowser(`Aevra: ${title}`, body);
  }

  for (const item of oauthRequests) {
    const id = String(item.id);
    if (seenOauth.has(id)) continue;
    seenOauth.add(id);
    const client = item.clientName ?? item.clientId ?? 'Remote AI';
    const scopes = (item.requestedScopes ?? item.scopes ?? []).join(', ') || 'mcp';
    const body = `${client} wants to connect · scopes: ${scopes}`;
    toast(`OAuth connection request: ${body}`, 'info', 7600);
    notifyBrowser('Aevra: OAuth connection request', body);
  }

  const liveApprovals = new Set(pending.map((item) => String(item.id)));
  const liveOauth = new Set(oauthRequests.map((item) => String(item.id)));
  for (const id of [...seenApprovals]) {
    if (!liveApprovals.has(id)) seenApprovals.delete(id);
  }
  for (const id of [...seenOauth]) {
    if (!liveOauth.has(id)) seenOauth.delete(id);
  }
}
