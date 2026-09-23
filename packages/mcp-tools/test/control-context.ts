/**
 * Runtime context for control-tool tests. `callInner` answers the semantic
 * provider tools the control adapters call (desktop_describe, browser_snapshot,
 * desktop_set_value, ...) from an in-memory surface, so the tests exercise the
 * real control tool, plan parser, and plan executor end to end.
 */
export interface ControlContextOptions {
  connectionId?: string;
  identity?: (sessionId: string) => { connectionId?: string } | undefined;
  audit?: boolean;
  controlPlans?: unknown;
  reply?: (tool: string, args: any) => unknown;
}

let counter = 0;

export function controlContext(options: ControlContextOptions = {}) {
  counter += 1;
  const workspaceId = `ws-control-${counter}`;
  const calls: Array<{ sessionId: string; tool: string; args: any }> = [];
  const desktop: any = {
    snapshotId: 'snap-1',
    windowLeaseId: 'lease-1',
    truncated: false,
    nodes: [
      { ref: 'd1', role: 'button', name: 'Save', enabled: true, supportedActions: ['invoke'] },
      {
        ref: 'd2',
        role: 'edit',
        name: 'Title',
        value: 'old words',
        enabled: true,
        supportedActions: ['setValue', 'select'],
      },
      {
        ref: 'd3',
        role: 'checkbox',
        name: 'Wrap',
        enabled: true,
        toggleState: 'off',
        supportedActions: ['toggle'],
      },
    ],
  };
  const browser: any = {
    tabId: 't1',
    url: 'https://example.test/',
    snapshotVersion: 1,
    nodes: [
      { ref: 'e1', role: 'button', name: 'Go' },
      { ref: 'e2', role: 'textbox', name: 'Query' },
    ],
  };
  let snapshots = 1;
  const bump = () => {
    snapshots += 1;
    desktop.snapshotId = `snap-${snapshots}`;
  };
  const node = (ref: string) => desktop.nodes.find((entry: any) => entry.ref === ref);
  const audit = { events: [] as any[], append: (e: any) => void audit.events.push(e) };
  const deps: any = {
    ...(options.audit === false ? {} : { audit }),
    ...(options.controlPlans ? { controlPlans: options.controlPlans } : {}),
  };
  const sessions: any = {
    get: (id: string) => ({ id, actor: 'oauth:ChatGPT', subject: 'subject' }),
    activeLease: () => ({ workspaceId, capabilities: ['desktop.control', 'browser.control'] }),
    isYolo: () => true,
  };
  if (options.identity) sessions.connectionIdentity = options.identity;
  else if (options.connectionId) {
    sessions.connectionIdentity = () => ({ connectionId: options.connectionId });
  }
  const value: any = {
    sessions,
    workspaces: { capabilityRoots: () => [] },
    worker: { execute: async () => ({ ok: true, value: {} }) },
    reads: {},
    deps,
    oneTimeCapabilities: new Set<string>(),
    processStart: async () => ({}),
    async callInner(sessionId: string, tool: string, args: any) {
      calls.push({ sessionId, tool, args });
      const custom = options.reply?.(tool, args);
      if (custom !== undefined) return custom;
      if (tool === 'desktop_describe') return structuredClone(desktop);
      if (tool === 'browser_snapshot') return structuredClone(browser);
      if (tool === 'browser_act_many') return [{ ok: true }];
      if (tool === 'desktop_set_value') {
        node(args.ref).value = args.value;
        bump();
        return { ok: true };
      }
      if (tool === 'desktop_toggle') {
        const target = node(args.ref);
        target.toggleState = target.toggleState === 'on' ? 'off' : 'on';
        bump();
        return { ok: true };
      }
      bump();
      return { ok: true };
    },
  };
  return { value, calls, audit, desktop, browser, workspaceId };
}

/** A minimal valid control plan against one observed surface. */
export function plan(surfaceId: string, observationId: string, overrides: any = {}) {
  return {
    schemaVersion: 1,
    requestId: overrides.requestId ?? `req-${Math.random().toString(36).slice(2)}`,
    surfaceIds: [surfaceId],
    expectedObservations: { [surfaceId]: observationId },
    mode: 'sharedSemantic',
    deadlineMs: 5000,
    maxConcurrency: 1,
    steps: overrides.steps ?? [
      {
        id: 's1',
        surfaceId,
        dependsOn: [],
        target: { ref: overrides.ref ?? 'e1' },
        action: overrides.action ?? { op: 'click' },
        preconditions: [],
        postcondition: { kind: 'enabled', equals: true },
        timeoutMs: 1000,
      },
    ],
    output: { kind: 'full', maxOutputTokens: 500 },
  };
}
