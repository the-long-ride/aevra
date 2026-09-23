import type {
  CapabilityRoot,
  CommandInput,
  ExecutionMode,
  AevraErrorCode,
  NetworkPolicy,
  ProcessLifecycle,
} from './index.js';
import type {
  BrowserActionInput,
  BrowserLogKind,
  BrowserReadFormat,
  BrowserSnapshotMode,
  BrowserTabAction,
  BrowserTransport,
} from './browser.js';
import { BROWSER_OPERATION_KINDS } from './browser.js';
import type { BackgroundActionInput, DesktopPolicy } from './desktop.js';
import { DESKTOP_OPERATION_KINDS } from './desktop.js';
import type { McpUpstreamCall } from './mcp-upstream.js';
import { MCP_UPSTREAM_OPERATION_KINDS } from './mcp-upstream.js';
import type { UpstreamTransportConfig } from '../../mcp-upstream/src/transport.js';

export type SearchQueryMode = 'text' | 'regex' | 'files';
export interface NativeSearchQuery {
  value: string;
  mode: SearchQueryMode;
  path: string;
}

/**
 * One workspace-declared protected path, in the only shape that survives the
 * worker IPC boundary.
 *
 * The core `SecurityGuard` authorizes against compiled `RegExp`s, and a RegExp
 * does not cross JSON. The executor re-classifies every file it opens as
 * defense in depth, and without the source glob it can apply only the built-in
 * rules - so a manifest-declared `protectedPaths` entry stopped at the
 * authorization layer and never reached the code that actually reads bytes.
 * That gap was visible in `file_search`, which authorizes the search ROOT and
 * then lets the executor decide each hit: a declared-SECRET file's contents
 * came back anyway. Carrying the glob text on the operation lets the executor
 * compile its own copy and apply the same rule to every candidate.
 */
export interface ProtectedGlob {
  glob: string;
  class: 'SENSITIVE' | 'SECRET';
}

export type WorkerOperation =
  | { kind: 'file.list'; path: string }
  | {
      kind: 'file.read';
      path: string;
      offset?: number;
      length?: number;
      protectedGlobs?: ProtectedGlob[];
    }
  | { kind: 'file.search'; path: string; query: string; protectedGlobs?: ProtectedGlob[] }
  | {
      kind: 'search.multi';
      queries: NativeSearchQuery[];
      maxResultsPerQuery: number;
      protectedGlobs?: ProtectedGlob[];
    }
  | {
      kind: 'hook.run';
      event: string;
      hookKind: string;
      executable: string;
      args: string[];
      env: Record<string, string>;
      timeoutMs: number;
      execution: 'run' | 'launch';
      context: Record<string, unknown>;
      payload: unknown;
    }
  | { kind: 'file.create'; path: string; content: string; encoding: 'utf8' | 'base64' }
  | { kind: 'file.write'; path: string; content: string; encoding: 'utf8' | 'base64' }
  | { kind: 'file.patch'; path: string; patch: string }
  | { kind: 'file.move'; from: string; to: string }
  | { kind: 'file.delete'; path: string; recursive: boolean }
  | { kind: 'git.status' }
  | { kind: 'git.add'; args: string[] }
  | { kind: 'git.diff'; args: string[] }
  | { kind: 'git.log'; args: string[] }
  | { kind: 'git.branch'; args: string[] }
  | { kind: 'git.commit'; message: string; args: string[] }
  | { kind: 'git.push'; remote?: string; branch?: string; args: string[] }
  | {
      kind: 'command.run';
      command: CommandInput;
      sandboxBackend?: 'auto' | 'docker' | 'podman';
      cachePolicy?: 'shared' | 'workspace' | 'disabled';
      networkPolicy?: NetworkPolicy;
    }
  | { kind: 'process.start'; command: CommandInput; lifecycle: ProcessLifecycle }
  | { kind: 'process.list' }
  | { kind: 'process.status'; processId: string }
  | { kind: 'process.wait'; processId: string; timeoutMs?: number }
  | { kind: 'process.logs'; processId: string; cursor?: string }
  | { kind: 'process.stop'; processId: string }
  | { kind: 'process.restart'; processId: string }
  | { kind: 'recovery.snapshot'; path: string; destination: string }
  | { kind: 'recovery.restore'; snapshot: string; path: string }
  | {
      kind: 'browser.connect';
      transport: BrowserTransport;
      cdpPort?: number;
      tabId?: string;
      epoch?: number;
      extensionId?: string;
    }
  | { kind: 'browser.tabs'; action: BrowserTabAction; url?: string; tabId?: string }
  | { kind: 'browser.navigate'; tabId?: string; url: string; waitUntil: 'load' | 'idle' }
  | { kind: 'browser.snapshot'; tabId?: string; mode: BrowserSnapshotMode; maxNodes: number }
  | {
      kind: 'browser.read';
      tabId?: string;
      ref?: string;
      selector?: string;
      format: BrowserReadFormat;
    }
  | { kind: 'browser.act'; tabId?: string; actions: BrowserActionInput[]; stopOnError: boolean }
  | { kind: 'browser.logs'; tabId?: string; logKind: BrowserLogKind; limit: number; since?: string }
  | { kind: 'browser.disconnect'; epoch?: number; all?: boolean }
  | { kind: 'browser.status'; epoch?: number; extensionId?: string }
  | { kind: 'desktop.connect' }
  | { kind: 'desktop.status' }
  | { kind: 'desktop.disconnect' }
  | { kind: 'desktop.apps' }
  | { kind: 'desktop.windows' }
  | { kind: 'desktop.targetIdentity'; windowId: string }
  | {
      kind: 'desktop.describe';
      windowId?: string;
      maxNodes: number;
      interactiveOnly: boolean;
      mode?: 'foreground' | 'background';
      policy?: DesktopPolicy;
    }
  | { kind: 'desktop.capture'; windowId?: string }
  | {
      kind: 'desktop.act';
      op: 'click' | 'type' | 'key' | 'scroll';
      ref?: string;
      x?: number;
      y?: number;
      text?: string;
      keys?: string;
      deltaY?: number;
      policy: DesktopPolicy;
    }
  | {
      kind: 'desktop.backgroundAct';
      action: BackgroundActionInput;
      policy: DesktopPolicy;
    }
  | {
      kind: 'desktop.releaseWindow';
      windowId: string;
      windowLeaseId: string;
    }
  | { kind: 'mcp.upstream.connect'; upstreamId: string; config: UpstreamTransportConfig }
  | { kind: 'mcp.upstream.disconnect'; upstreamId?: string }
  | { kind: 'mcp.upstream.status'; upstreamId?: string }
  | { kind: 'mcp.upstream.catalog'; upstreamId: string }
  | { kind: 'mcp.upstream.call'; upstreamId: string; call: McpUpstreamCall }
  | { kind: 'sandbox.inspect' };

export interface OperationEnvelope {
  version: 1;
  daemonInstanceId: string;
  operationId: string;
  sessionId: string;
  workspaceId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  executionMode: ExecutionMode;
  capabilityRoots: CapabilityRoot[];
  operation: WorkerOperation;
  expectedState?: Record<string, string>;
  mac: string;
}

export type VerifiedEnvelope = OperationEnvelope & { verifiedAt: string };
export type WorkerResult =
  | { ok: true; value: unknown; observedState?: Record<string, string> }
  | {
      ok: false;
      error: { code: AevraErrorCode; message: string; details?: Record<string, unknown> };
    };

const kinds = new Set<string>([
  'file.list',
  'file.read',
  'file.search',
  'search.multi',
  'hook.run',
  'file.create',
  'file.write',
  'file.patch',
  'file.move',
  'file.delete',
  'git.status',
  'git.add',
  'git.diff',
  'git.log',
  'git.branch',
  'git.commit',
  'git.push',
  'command.run',
  'process.start',
  'process.list',
  'process.status',
  'process.wait',
  'process.logs',
  'process.stop',
  'process.restart',
  'recovery.snapshot',
  'recovery.restore',
  'sandbox.inspect',
  ...BROWSER_OPERATION_KINDS,
  ...DESKTOP_OPERATION_KINDS,
  ...MCP_UPSTREAM_OPERATION_KINDS,
]);

function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected object');
  return v as Record<string, unknown>;
}

export function parseOperationEnvelope(value: unknown): OperationEnvelope {
  const r = obj(value);
  if (r.version !== 1) throw new Error('Unsupported envelope version');
  const op = obj(r.operation);
  if (typeof op.kind !== 'string' || !kinds.has(op.kind)) throw new Error('Unknown operation kind');
  for (const k of [
    'daemonInstanceId',
    'operationId',
    'sessionId',
    'workspaceId',
    'issuedAt',
    'expiresAt',
    'nonce',
    'mac',
  ]) {
    if (typeof r[k] !== 'string' || !(r[k] as string).length) throw new Error(`Invalid ${k}`);
  }
  if (r.executionMode !== 'sandbox' && r.executionMode !== 'host') {
    throw new Error('Invalid executionMode');
  }
  if (!Array.isArray(r.capabilityRoots)) throw new Error('Invalid capabilityRoots');
  return r as unknown as OperationEnvelope;
}
