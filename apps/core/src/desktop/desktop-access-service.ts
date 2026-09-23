import { randomUUID } from 'node:crypto';
import type {
  DesktopAppGrant,
  DesktopTargetIdentity,
} from '../../../../packages/protocol/src/desktop.js';
import {
  type DesktopAccessDuration,
  type DesktopAccessRequestRecord,
  type DesktopAppGrantRecord,
  type NewDesktopAppGrant,
} from '../../../../packages/store/src/desktop-access.js';
import {
  basename,
  canonicalExecutablePath,
} from '../../../../packages/security/src/window-gate.js';
import {
  bindingFor,
  executablePath,
  fail,
  publicGrant,
  REQUEST_LIFETIME_MS,
  sameBinding,
  type DesktopAccessServiceDeps,
} from './desktop-access-support.js';

export class DesktopAccessService {
  constructor(private readonly deps: DesktopAccessServiceDeps) {}

  private liveGrants() {
    const grants = this.deps.repository.listGrants();
    const live: DesktopAppGrantRecord[] = [];
    for (const grant of grants) {
      if (grant.sessionId && !this.deps.sessions.get(grant.sessionId)) {
        this.deps.repository.revokeGrant(grant.id);
      } else {
        live.push(grant);
      }
    }
    return live;
  }

  request(input: {
    actor: string;
    sessionId: string;
    workspaceId: string;
    windowId: string;
    duration: DesktopAccessDuration;
    identity: DesktopTargetIdentity;
  }) {
    if (input.duration !== 'session' && input.duration !== 'persistent') {
      fail('INVALID_REQUEST', 'duration must be session or persistent');
    }
    if (input.identity.window.windowId !== input.windowId) {
      fail('DESKTOP_TARGET_CHANGED', 'The requested window identity did not match the live HWND');
    }
    const liveSession = this.deps.sessions.get(input.sessionId);
    const liveLease = this.deps.sessions.leaseForWorkspace(input.sessionId, input.workspaceId);
    if (
      !liveSession ||
      liveSession.actor !== input.actor ||
      !liveLease?.capabilities.includes('desktop.control')
    ) {
      fail(
        'DESKTOP_ACCESS_SESSION_ENDED',
        'The requesting desktop-control session is no longer active',
      );
    }
    const binding = bindingFor(input.identity);
    const now = new Date();
    const createdAt = now.toISOString();
    const stored = this.deps.repository.createOrGetPending({
      id: randomUUID(),
      actor: input.actor,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      windowId: input.identity.window.windowId,
      targetExecutablePath: binding.targetPath,
      targetProcessId: input.identity.windowInstance.processId,
      targetProcessStartedAt: input.identity.windowInstance.processStartedAt,
      hostExecutablePath: binding.host.executablePath,
      hostWindowId: binding.host.instance.windowId,
      hostProcessId: binding.host.instance.processId,
      hostProcessStartedAt: binding.host.instance.processStartedAt,
      requestedDuration: input.duration,
      expiresAt: new Date(now.getTime() + REQUEST_LIFETIME_MS).toISOString(),
      createdAt,
      updatedAt: createdAt,
    });
    this.deps.audit?.append({
      actor: input.actor,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      tool: 'desktop_request_access',
      operation: 'desktop:request_access',
      target: binding.displayName,
      risk: 'HIGH',
      result: stored.existing ? 'PENDING_DEDUPLICATED' : 'PENDING',
      redactionCount: 0,
      class: 'security',
    });
    return {
      requestId: stored.request.id,
      status: stored.request.state,
      application: binding.displayName,
      duration: stored.request.requestedDuration,
      expiresAt: stored.request.expiresAt,
      deduplicated: stored.existing,
      message: 'A human administrator must review this app access request.',
    };
  }

  policyGrants(sessionId?: string): DesktopAppGrant[] {
    return this.liveGrants()
      .filter((grant) => grant.sessionId === null || grant.sessionId === sessionId)
      .map((grant) => ({
        id: grant.id,
        executablePath: grant.executablePath,
        displayName: grant.displayName,
        createdAt: grant.createdAt,
        ...(grant.sessionId ? { sessionId: grant.sessionId } : {}),
      }));
  }

  listPending(): DesktopAccessRequestRecord[] {
    const pending = this.deps.repository.listPending(new Date().toISOString());
    return pending.filter((request) => {
      const session = this.deps.sessions.get(request.sessionId);
      const lease = this.deps.sessions.leaseForWorkspace(request.sessionId, request.workspaceId);
      if (
        session &&
        session.actor === request.actor &&
        lease?.capabilities.includes('desktop.control')
      )
        return true;
      this.deps.repository.expireRequest(request.id, new Date().toISOString());
      return false;
    });
  }

  listGrants() {
    return this.liveGrants().map(publicGrant);
  }

  renameGrantsForPath(executablePath: string, displayName: string): void {
    this.deps.repository.renameGrantsForPath(
      canonicalExecutablePath(executablePath),
      displayName.trim().slice(0, 120),
    );
  }

  grantExplicitApp(input: { executablePath: string; displayName: string }, decidedBy = 'admin') {
    const path = executablePath(input.executablePath);
    if (!path) fail('INVALID_REQUEST', 'executablePath must be an absolute .exe path');
    const displayName =
      input.displayName.trim().slice(0, 120) || basename(path).replace(/\.exe$/i, '');
    const createdAt = new Date().toISOString();
    const grant = this.deps.repository.saveGrant({
      id: randomUUID(),
      executablePath: path,
      pathKey: canonicalExecutablePath(path),
      displayName,
      createdAt,
      createdBy: decidedBy,
      sessionId: null,
    });
    this.deps.audit?.append({
      actor: decidedBy,
      tool: 'desktop_app_grant_create',
      operation: 'desktop:access:grant',
      target: displayName,
      risk: 'HIGH',
      result: 'GRANTED',
      redactionCount: 0,
      class: 'security',
    });
    return publicGrant(grant);
  }

  async approve(requestId: string, scope: DesktopAccessDuration, decidedBy = 'admin') {
    if (scope !== 'session' && scope !== 'persistent') {
      fail('INVALID_REQUEST', 'scope must be session or persistent');
    }
    const request = this.deps.repository.getRequest(requestId);
    if (!request || request.state !== 'PENDING') {
      fail('DESKTOP_ACCESS_REQUEST_NOT_PENDING', 'Desktop access request is no longer pending');
    }
    if (Date.parse(request.expiresAt) <= Date.now()) {
      this.deps.repository.expireRequest(request.id, new Date().toISOString());
      fail('DESKTOP_ACCESS_REQUEST_EXPIRED', 'Desktop access request expired');
    }

    const session = this.deps.sessions.get(request.sessionId);
    const lease = this.deps.sessions.leaseForWorkspace(request.sessionId, request.workspaceId);
    if (
      !session ||
      session.actor !== request.actor ||
      !lease?.capabilities.includes('desktop.control')
    ) {
      this.deps.repository.expireRequest(request.id, new Date().toISOString());
      fail(
        'DESKTOP_ACCESS_SESSION_ENDED',
        'The requesting desktop-control session is no longer active',
      );
    }

    const observed = await this.deps.worker.execute({
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      roots: this.deps.capabilityRoots(request.workspaceId),
      operation: { kind: 'desktop.targetIdentity', windowId: request.windowId },
      executionMode: 'host',
    });
    if (!observed.ok) {
      if (
        ['DESKTOP_TARGET_CHANGED', 'DESKTOP_HOST_UNVERIFIED', 'DESKTOP_INPUT_REFUSED'].includes(
          observed.error.code,
        )
      ) {
        this.deps.repository.expireRequest(request.id, new Date().toISOString());
      }
      fail(observed.error.code, observed.error.message);
    }
    if (!sameBinding(request, observed.value as DesktopTargetIdentity)) {
      this.deps.repository.expireRequest(request.id, new Date().toISOString());
      fail('DESKTOP_TARGET_CHANGED', 'The target or verified host changed; no grant was created');
    }

    const currentSession = this.deps.sessions.get(request.sessionId);
    const currentLease = this.deps.sessions.leaseForWorkspace(
      request.sessionId,
      request.workspaceId,
    );
    if (
      !currentSession ||
      currentSession.actor !== request.actor ||
      !currentLease?.capabilities.includes('desktop.control')
    ) {
      this.deps.repository.expireRequest(request.id, new Date().toISOString());
      fail(
        'DESKTOP_ACCESS_SESSION_ENDED',
        'The requesting desktop-control session is no longer active',
      );
    }

    const hostPath = request.hostExecutablePath;
    const grantInput: NewDesktopAppGrant = {
      id: randomUUID(),
      executablePath: hostPath,
      pathKey: canonicalExecutablePath(hostPath),
      displayName: basename(hostPath).replace(/\.exe$/i, '') || basename(hostPath),
      createdAt: new Date().toISOString(),
      createdBy: decidedBy,
      sessionId: scope === 'session' ? request.sessionId : null,
    };
    const approved = this.deps.repository.approveRequest(
      requestId,
      scope,
      decidedBy,
      new Date().toISOString(),
      grantInput,
    );
    if (!approved)
      fail('DESKTOP_ACCESS_REQUEST_NOT_PENDING', 'Desktop access request is no longer pending');
    this.deps.audit?.append({
      actor: decidedBy,
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      tool: 'desktop_access_approve',
      operation: 'desktop:access:approve',
      target: grantInput.displayName,
      risk: 'HIGH',
      decision: scope,
      result: 'APPROVED',
      redactionCount: 0,
      class: 'security',
    });
    return { request: approved.request, grant: publicGrant(approved.grant) };
  }

  deny(requestId: string, decidedBy = 'admin') {
    const request = this.deps.repository.denyRequest(
      requestId,
      decidedBy,
      new Date().toISOString(),
    );
    if (!request)
      fail('DESKTOP_ACCESS_REQUEST_NOT_PENDING', 'Desktop access request is no longer pending');
    this.deps.audit?.append({
      actor: decidedBy,
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      tool: 'desktop_access_deny',
      operation: 'desktop:access:deny',
      target: basename(request.hostExecutablePath),
      risk: 'HIGH',
      result: 'DENIED',
      redactionCount: 0,
      class: 'security',
    });
    return request;
  }

  revokeGrant(id: string, decidedBy = 'admin') {
    const grant = this.deps.repository.revokeGrant(id);
    if (!grant) fail('NOT_FOUND', 'Desktop app grant not found');
    this.deps.audit?.append({
      actor: decidedBy,
      tool: 'desktop_access_revoke',
      operation: 'desktop:access:revoke',
      target: grant.displayName,
      risk: 'HIGH',
      result: 'REVOKED',
      redactionCount: 0,
      class: 'security',
    });
    return publicGrant(grant);
  }
}
