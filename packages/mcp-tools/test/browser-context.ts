/**
 * Minimal runtime context for the browser tool gate. The worker is a stub that
 * records what it was asked to do, so the tests measure policy decisions rather
 * than driver behaviour.
 */
export function browserContext(tabUrl = 'https://example.com/', options: { yolo?: boolean } = {}) {
  const worker: any = {
    calls: [] as any[],
    execute: async (input: any) => {
      worker.calls.push(input);
      const kind = input.operation.kind;
      if (kind === 'browser.tabs') {
        return {
          ok: true,
          value: [{ tabId: 't1', url: tabUrl, title: 'Example', active: true }],
        };
      }
      if (kind === 'browser.read') {
        return { ok: true, value: { tabId: 't1', url: tabUrl, content: 'page text' } };
      }
      if (kind === 'browser.snapshot') {
        return {
          ok: true,
          value: { tabId: 't1', url: tabUrl, snapshotVersion: 1, mode: 'a11y', nodes: [] },
        };
      }
      return { ok: true, value: { kind } };
    },
  };
  const audit = { events: [] as any[], append: (e: any) => void audit.events.push(e) };
  return {
    worker,
    audit,
    value: {
      sessions: {
        get: () => ({ id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' }),
        activeLease: () => ({ workspaceId: 'w1', capabilities: ['browser.control'] }),
        isYolo: () => options.yolo === true,
      } as any,
      workspaces: { capabilityRoots: () => [] } as any,
      worker,
      reads: {} as any,
      deps: { audit } as any,
      oneTimeCapabilities: new Set<string>(),
      processStart: async () => ({}),
      callInner: async () => ({}),
    } as any,
  };
}
