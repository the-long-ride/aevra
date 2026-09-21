export function processGitTestContext(
  options: {
    yolo?: boolean;
    workerFailure?: boolean;
    permissionOutcome?: 'allow' | 'deny' | 'approval';
  } = {},
) {
  const workerCalls: any[] = [];
  const processCalls: any[] = [];
  const changeCalls: any[] = [];
  const lease = { workspaceId: 'w1', capabilities: [] };
  const sessions: any = {
    get: () => ({ id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' }),
    activeLease: () => lease,
    leaseForWorkspace: (_sid: string, workspaceId: string) =>
      workspaceId === lease.workspaceId ? lease : null,
    leases: () => [lease],
    isYolo: () => options.yolo ?? true,
  };
  const processes: any = {
    start: async (...args: any[]) => {
      processCalls.push(['start', ...args]);
      return { id: 'p1', state: 'running' };
    },
    list: (sessionId: string) => {
      processCalls.push(['list', sessionId]);
      return [{ id: 'p1' }];
    },
    status: async (...args: any[]) => {
      processCalls.push(['status', ...args]);
      return { ok: true, value: { id: args[1], state: 'running' } };
    },
    wait: async (...args: any[]) => {
      processCalls.push(['wait', ...args]);
      return { ok: true, value: { id: args[1], state: 'completed' } };
    },
    command: async (...args: any[]) => {
      processCalls.push(['command', ...args]);
      return { ok: true, value: { id: args[2], kind: args[1], cursor: args[3] } };
    },
  };
  const changes: any = {
    begin: (...args: any[]) => {
      changeCalls.push(['begin', ...args]);
      return { id: 'c1' };
    },
    status: (...args: any[]) => {
      changeCalls.push(['status', ...args]);
      return { id: args[0], state: 'OPEN' };
    },
    commit: (...args: any[]) => {
      changeCalls.push(['commit', ...args]);
      return { id: args[0], state: 'COMMITTED' };
    },
    rollback: async (...args: any[]) => {
      changeCalls.push(['rollback', ...args]);
      return { id: args[0], state: 'ROLLED_BACK' };
    },
  };
  const worker: any = {
    execute: async (input: any) => {
      workerCalls.push(input);
      if (options.workerFailure)
        return { ok: false, error: { code: 'INVALID_REQUEST', message: 'worker failed' } };
      if (input.operation.kind === 'git.log' && input.operation.args?.includes('--format=%H')) {
        return { ok: true, value: { stdout: 'abc123\n' } };
      }
      return { ok: true, value: { kind: input.operation.kind } };
    },
  };
  return {
    value: {
      sessions,
      workspaces: { capabilityRoots: () => [] },
      worker,
      reads: {} as any,
      // Unrestricted YOLO keeps this dispatch coverage over every git operation; the
      // workspace-scoped default sends git_push to approval by design.
      deps: {
        processes,
        permissions: options.permissionOutcome
          ? {
              decide: () => ({ outcome: options.permissionOutcome, reason: 'test permission' }),
              listRules: () => [],
            }
          : undefined,
        changes,
        settings: {
          get: (key: string, fallback: any) =>
            key === 'policy.yolo' ? { mode: 'unrestricted' } : fallback,
        },
      },
      oneTimeCapabilities: new Set<string>(),
      processStart: async () => ({}),
      callInner: async () => ({}),
    } as any,
    workerCalls,
    processCalls,
    changeCalls,
  };
}
