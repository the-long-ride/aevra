import type { ConnectionStateStore } from './connection-state.js';
import type { ConnectionTicketLike, SecuritySession } from './session-types.js';

export interface SessionScope {
  sessions: Map<string, SecuritySession>;
  disconnected: Map<
    string,
    { actor: string; subject: string; connectionId?: string; disconnectedAt?: string }
  >;
  yolo: Set<string>;
  connections?: ConnectionStateStore;
}

export function connectionIdentityFor(scope: SessionScope, sessionId: string) {
  const source = scope.sessions.get(sessionId) ?? scope.disconnected.get(sessionId);
  if (!source) return null;
  const connectionKind = source.connectionId
    ? 'oauth'
    : source.actor.startsWith('connector:')
      ? 'connector'
      : 'session';
  return {
    connectionKind,
    actor: source.actor,
    subject: source.subject,
    ...(source.connectionId ? { connectionId: source.connectionId } : {}),
  };
}

export function connectionIdFor(scope: SessionScope, sessionId: string) {
  return (
    scope.sessions.get(sessionId)?.connectionId ??
    scope.disconnected.get(sessionId)?.connectionId ??
    scope.connections?.connectionIdForSession(sessionId) ??
    null
  );
}

/** A session id, or an approval ticket whose frozen identity outlives its session. */
export type GrantSource = string | ConnectionTicketLike;

/**
 * Resolves who a connection workspace grant belongs to. A rotating client's
 * requesting session may be gone when the operator approves, so a ticket falls
 * back to the connection subject frozen on it, unless that connection was revoked.
 */
export function grantSourceFor(scope: SessionScope, from: GrantSource) {
  const sessionId = typeof from === 'string' ? from : from.sessionId;
  const live = scope.sessions.get(sessionId) ?? scope.disconnected.get(sessionId);
  if (live) return live;
  if (typeof from !== 'string' && from.connectionSubject) {
    const connectionId = from.connectionId;
    if (connectionId && scope.connections?.state(connectionId)?.status === 'REVOKED') {
      throw new Error('connection revoked');
    }
    return { actor: from.actor, subject: from.connectionSubject };
  }
  throw new Error('session identity not found');
}

export function connectionHasMultipleSessions(
  scope: SessionScope,
  ticket: ConnectionTicketLike,
  now = Date.now(),
  windowMs = 15 * 60_000,
): boolean {
  if (!ticket.actor.startsWith('oauth:')) return false;
  const targetConnId = ticket.connectionId;
  if (!targetConnId) return false;

  const sessionIds = new Set<string>();
  for (const s of scope.sessions.values()) {
    if (s.actor !== ticket.actor || s.connectionId !== targetConnId) continue;
    const activity = Date.parse(s.lastActivityAt || s.createdAt);
    if (!isNaN(activity) && now - activity <= windowMs) {
      sessionIds.add(s.id);
    }
  }

  for (const [id, ident] of scope.disconnected.entries()) {
    if (ident.actor !== ticket.actor || ident.connectionId !== targetConnId) continue;
    const activity = ident.disconnectedAt ? Date.parse(ident.disconnectedAt) : NaN;
    if (!isNaN(activity) && now - activity <= windowMs) {
      sessionIds.add(id);
    }
  }

  if (ticket.sessionId) {
    sessionIds.add(ticket.sessionId);
  }

  return sessionIds.size >= 3;
}
