import { onceProof } from './once-proof-fixture.js';
export function ticket(tool: string, args: any = {}, overrides: any = {}) {
  return {
    id: 'req1',
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: { family: 'files:write', capability: 'files.write', risk: 'HIGH', argsHash: 'x' },
    payload: { tool, args },
    expectedState: {},
    state: 'APPROVED',
    decisionScope: 'once',
    ...overrides,
  };
}

export const SELECT_OP = {
  family: 'workspace:select',
  capability: 'files.read',
  risk: 'MEDIUM',
  argsHash: 'x',
};
export const CAP_OP = {
  family: 'npm:test',
  capability: 'commands.run',
  risk: 'HIGH',
  argsHash: 'x',
};

export function fixture(t: any, o: any = {}) {
  const calls: any[] = [];
  const lease = o.lease ?? {
    workspaceId: 'w1',
    capabilities: ['files.write', 'git.commit', 'git.push'],
  };
  const session = o.session === undefined ? { id: 's1', actor: t.actor } : o.session;
  const context: any = {
    sessions: {
      get: () => session,
      activeLease: () => lease,
      leases: () => [lease],
      leaseForWorkspace: o.noLeaseForWorkspace ? () => undefined : () => lease,
      connectionIdentity: () => o.identity ?? null,
      switchWorkspace: async (...args: any[]) => {
        calls.push(['switch', ...args]);
        return { status: 'admitted', lease: { workspaceId: 'w1', capabilities: ['files.read'] } };
      },
    },
    workspaces: {
      getLocal: (id: string) =>
        id === 'w1' ? { id, name: 'One', description: 'd', hostRoot: o.hostRoot } : null,
      capabilityRoots: () => [],
    },
    worker: {
      execute: async (input: any) => {
        calls.push(['worker', input]);
        if (input.operation.kind === 'git.log')
          return { ok: true, value: { stdout: o.head ?? '' } };
        return { ok: true, value: { kind: input.operation.kind } };
      },
    },
    approvals: {
      status: () => t,
      resume: async (_id: string, validate: any, execute: any, claim?: any) => {
        const checked = await validate(t);
        if (!checked.ok) return checked;
        o.beforeClaim?.(session);
        if (claim) {
          const claimed = await claim(t);
          if (!claimed.ok) return claimed;
        }
        return execute(t);
      },
    },
    deps: {
      manifests: o.manifests,
      processes: o.processes,
    },
    capabilityApprovalProof: onceProof(o.oneTime?.[0]),
    callInner: async (...args: any[]) => {
      calls.push(['callInner', ...args]);
      return { replayed: args[1] };
    },
  };
  return { context, calls };
}
