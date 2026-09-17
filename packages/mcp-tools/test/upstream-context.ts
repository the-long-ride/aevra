import type { UpstreamCatalog } from '../../mcp-upstream/src/protocol.js';
import type { RiskTier } from '../../protocol/src/index.js';
import { McpToolService } from '../src/service.js';
import type {
  UpstreamRegistryService,
  UpstreamServerSummary,
  UpstreamState,
} from '../src/upstream-port.js';

export interface FakeUpstreamOptions {
  name?: string;
  risk?: RiskTier;
  enabled?: boolean;
  state?: UpstreamState;
  catalog?: Partial<UpstreamCatalog>;
  toolResult?: unknown;
  toolError?: Error;
  leaseCapabilities?: string[];
}

export function fakeUpstreams(options: FakeUpstreamOptions = {}) {
  const summary: UpstreamServerSummary = {
    id: 'up_1',
    name: options.name ?? 'github',
    risk: options.risk ?? 'MEDIUM',
    enabled: options.enabled ?? true,
    state: options.state ?? 'active',
  };
  const catalog: UpstreamCatalog = {
    tools: options.catalog?.tools ?? [{ name: 'search', description: 'Search issues' }],
    resources: options.catalog?.resources ?? [{ uri: 'repo://readme', name: 'README' }],
    prompts: options.catalog?.prompts ?? [{ name: 'triage', description: 'Triage an issue' }],
  };
  const calls: Array<{ kind: string; server: string; entry: string; args: unknown }> = [];
  const port: UpstreamRegistryService = {
    list: () => [summary],
    findByName: (name) => (name === summary.name ? summary : null),
    catalogByName: (name) => (name === summary.name ? catalog : null),
    callTool: async (server, tool, args) => {
      calls.push({ kind: 'tool', server, entry: tool, args });
      if (options.toolError) throw options.toolError;
      return options.toolResult ?? { content: [{ type: 'text', text: 'ok' }] };
    },
    readResource: async (server, uri) => {
      calls.push({ kind: 'resource', server, entry: uri, args: null });
      return { contents: [{ uri, mimeType: 'text/plain', text: 'body' }] };
    },
    getPrompt: async (server, prompt, args) => {
      calls.push({ kind: 'prompt', server, entry: prompt, args });
      return { description: 'triage', messages: [] };
    },
  };
  return { summary, catalog, calls, port };
}

export function upstreamService(options: FakeUpstreamOptions = {}) {
  const fake = fakeUpstreams(options);
  const audit = { events: [] as any[], append: (event: any) => void audit.events.push(event) };
  const approvals = {
    requests: [] as any[],
    request: async (request: any) => {
      approvals.requests.push(request);
      return { status: 'approval_pending' as const, requestId: 'r1' };
    },
  };
  const sessions = {
    get: () => ({ id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' }),
    touch() {},
    activeLease: () => ({
      workspaceId: 'w1',
      capabilities: options.leaseCapabilities ?? ['mcp.proxy'],
    }),
    isYolo: () => false,
  } as any;
  const workspaces = {
    capabilityRoots: () => [],
    listRemote: () => [],
    getLocal: () => ({ id: 'w1', hostRoot: 'F:/workspace', name: 'workspace', description: '' }),
  } as any;
  const worker = { execute: async () => ({ ok: true, value: {} }) } as any;
  const service = new McpToolService(
    sessions,
    workspaces,
    worker,
    { put() {} } as any,
    approvals as any,
    {
      audit: audit as any,
      skills: {
        list: () => [],
        read: () => null,
        instructions: () => ({ instructions: [] }),
      } as any,
      upstreams: fake.port,
    },
  );
  return { ...fake, service, audit, approvals };
}
