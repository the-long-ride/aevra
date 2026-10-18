import { parseAgentArgs, type AgentCliCommand } from '../src/agent-args.js';
import type { AgentCommandDependencies } from '../src/commands/agent-command.js';

export const detected = [
  { target: 'codex', found: true, evidence: 'path', configPath: '/c', scopes: ['user'] },
  { target: 'claude-code', found: false, evidence: 'none', configPath: '/cl', scopes: ['user'] },
  { target: 'opencode', found: true, evidence: 'config', configPath: '/o', scopes: ['user'] },
  { target: 'antigravity', found: false, evidence: 'none', configPath: '/a', scopes: ['user'] },
];

export interface Call {
  path: string;
  init?: { method?: string; body?: string };
}

export function harness(
  options: {
    interactive?: boolean;
    answer?: boolean;
    detect?: unknown;
    post?: (body: any) => { status?: number; body: unknown };
    registrations?: unknown[];
    workspaces?: Array<{ id: string; name: string }>;
  } = {},
) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const questions: string[] = [];
  const reply = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  const deps: AgentCommandDependencies = {
    async api(path, init) {
      calls.push({ path, init });
      if (path === '/api/agents/detect') return reply(200, options.detect ?? detected);
      if (path === '/api/agents' && init?.method === 'POST') {
        const result: { status?: number; body: unknown } = (
          options.post ?? ((body) => ({ body: okResponse(body) }))
        )(JSON.parse(init.body ?? '{}'));
        return reply(result.status ?? 200, result.body);
      }
      if (path === '/api/agents') return reply(200, { registrations: options.registrations ?? [] });
      throw new Error(`unexpected ${path}`);
    },
    log: (message) => void logs.push(message),
    error: (message) => void errors.push(message),
    formatError: (error) => (error as Error).message,
    isInteractive: () => options.interactive ?? true,
    async confirm(question) {
      questions.push(question);
      return options.answer ?? true;
    },
    async workspaces() {
      return options.workspaces ?? [{ id: 'ws-1', name: 'Demo' }];
    },
  };
  return { deps, calls, logs, errors, questions };
}

export function okResponse(body: { targets?: string[]; target?: string }) {
  const list = body.targets ?? [body.target ?? 'all'];
  return {
    registrations: [],
    results: list.map((target) => ({ target, ok: true })),
    changes: list.map((target) => ({ target, file: `/cfg/${target}`, action: 'create' })),
    notes: [],
  };
}

export const parse = (...rest: string[]) => parseAgentArgs(rest) as AgentCliCommand;
export const posts = (calls: Call[]) =>
  calls
    .filter((call) => call.init?.method === 'POST')
    .map((call) => JSON.parse(call.init?.body ?? '{}'));
