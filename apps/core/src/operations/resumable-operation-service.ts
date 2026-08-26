import type {
  OperationRepository,
  ResumableOperation,
} from '../../../../packages/store/src/operations.js';
import type { SessionManager } from '../sessions/session-manager.js';

export class ResumableOperationService {
  constructor(
    private operations: OperationRepository,
    private sessions: SessionManager,
  ) {}

  get(sessionId: string, operationId: string): ResumableOperation | null {
    const connectionId = this.connectionId(sessionId);
    if (!connectionId) return null;
    const operation = this.operations.getById(operationId);
    if (!operation || operation.connectionId !== connectionId) return null;
    this.operations.attachSession(operation.id, sessionId);
    return this.operations.getById(operation.id);
  }

  list(sessionId: string, limit = 50): ResumableOperation[] {
    const connectionId = this.connectionId(sessionId);
    return connectionId ? this.operations.listByConnection(connectionId, limit) : [];
  }

  private connectionId(sessionId: string) {
    if (!this.sessions.get(sessionId)) return null;
    const identity = this.sessions.connectionIdentity(sessionId);
    const connectionId = identity?.connectionId;
    if (!connectionId) return null;
    if (this.sessions.connectionState(connectionId)?.status === 'REVOKED') return null;
    return connectionId;
  }
}
