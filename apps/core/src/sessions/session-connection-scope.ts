import type { ConnectionStateStore } from './connection-state.js';
import type { SecuritySession } from './session-types.js';

export interface SessionScope {
  sessions: Map<string, SecuritySession>;
  disconnected: Map<string, { actor: string; subject: string; connectionId?: string }>;
  yolo: Set<string>;
  connections?: ConnectionStateStore;
}

export function connectionIdentityFor(scope: SessionScope, sessionId: string) {
  const source = scope.sessions.get(sessionId) ?? scope.disconnected.get(sessionId);
  if (!source) return null;
  return {
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
