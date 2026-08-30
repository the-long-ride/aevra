import { ALL_CAPABILITIES } from '../policy/capabilities.js';
import { isConnectorSessionActor } from './session-lease-continuity.js';
import { connectionIdFor, type SessionScope } from './session-connection-scope.js';

export function isYoloSession(scope: SessionScope, sessionId: string) {
  const connectionId = connectionIdFor(scope, sessionId);
  return connectionId && scope.connections
    ? scope.connections.isYolo(connectionId)
    : scope.yolo.has(sessionId);
}

export function enableYoloSession(scope: SessionScope, sessionId: string) {
  const session = scope.sessions.get(sessionId);
  if (!session) throw new Error('session not found');
  if (!isConnectorSessionActor(session.actor))
    throw new Error('YOLO mode is only available for connector sessions');
  const connectionId = connectionIdFor(scope, sessionId);
  if (connectionId && scope.connections) scope.connections.setYolo(connectionId, true);
  else scope.yolo.add(sessionId);
  return { sessionId, enabled: true, capabilities: [...ALL_CAPABILITIES] };
}

export function disableYoloSession(scope: SessionScope, sessionId: string) {
  const connectionId = connectionIdFor(scope, sessionId);
  if (connectionId && scope.connections) {
    const existed = scope.connections.isYolo(connectionId);
    scope.connections.setYolo(connectionId, false);
    return { sessionId, enabled: false, changed: existed };
  }
  const existed = scope.yolo.delete(sessionId);
  return { sessionId, enabled: false, changed: existed };
}
