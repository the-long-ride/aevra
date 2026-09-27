import type { SessionManager } from '../sessions/session-manager.js';
import {
  HostControlGrantRepository,
  type HostControlCapability,
  type HostControlIdentity,
} from '../../../../packages/store/src/host-control-grants.js';

export class HostControlAccess {
  private revocationHandler?: (
    identity: HostControlIdentity,
    capability: HostControlCapability,
  ) => void | Promise<void>;

  constructor(
    private sessions: Pick<SessionManager, 'connectionIdentity' | 'connectionState'>,
    private grants: HostControlGrantRepository,
    private connectorActive: (id: string) => boolean = () => true,
  ) {}
  identity(sessionId: string): HostControlIdentity | null {
    const source = this.sessions.connectionIdentity(sessionId);
    if (!source) return null;
    if (source.connectionKind === 'oauth' || (!source.connectionKind && source.connectionId)) {
      if (!source.connectionId || source.connectionId !== source.subject) return null;
      return { kind: 'oauth', key: source.connectionId };
    }
    if (source.connectionKind === 'connector') {
      if (!source.subject) return null;
      return { kind: 'connector', key: source.subject };
    }
    return { kind: 'session', key: sessionId };
  }
  setRevocationHandler(
    handler: (
      identity: HostControlIdentity,
      capability: HostControlCapability,
    ) => void | Promise<void>,
  ) {
    this.revocationHandler = handler;
  }
  isActive(identity: HostControlIdentity): boolean {
    if (identity.kind === 'connector') return this.connectorActive(identity.key);
    if (identity.kind === 'oauth') {
      const state = this.sessions.connectionState(identity.key);
      return Boolean(state && state.status !== 'REVOKED');
    }
    return true;
  }
  has(sessionId: string, capability: HostControlCapability): boolean {
    const identity = this.identity(sessionId);
    if (!identity) return false;
    if (!this.isActive(identity)) return false;
    return this.grants.get(identity, capability)?.revokedAt === null;
  }
  grant(identity: HostControlIdentity, capability: HostControlCapability, grantedBy: string) {
    if (!this.isActive(identity)) throw new Error('Host control connection is inactive');
    return this.grants.upsert(identity, capability, grantedBy);
  }
  async revoke(identity: HostControlIdentity, capability: HostControlCapability) {
    const revoked = this.grants.revoke(identity, capability);
    if (revoked) await this.revocationHandler?.(identity, capability);
    return revoked;
  }
  list(identity: HostControlIdentity) {
    return this.grants.list(identity);
  }
}
