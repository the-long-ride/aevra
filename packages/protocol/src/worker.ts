import type {
  CapabilityRoot,
  CommandInput,
  ExecutionMode,
  AevraErrorCode,
  NetworkPolicy,
  ProcessLifecycle,
} from './index.js';
export type WorkerOperation =
  | { kind: 'file.list'; path: string }
  | { kind: 'file.read'; path: string }
  | { kind: 'file.search'; path: string; query: string }
  | { kind: 'file.create'; path: string; content: string; encoding: 'utf8' | 'base64' }
  | { kind: 'file.write'; path: string; content: string; encoding: 'utf8' | 'base64' }
  | { kind: 'file.patch'; path: string; patch: string }
  | { kind: 'file.move'; from: string; to: string }
  | { kind: 'file.delete'; path: string; recursive: boolean }
  | { kind: 'git.status' }
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
const kinds = new Set([
  'file.list',
  'file.read',
  'file.search',
  'file.create',
  'file.write',
  'file.patch',
  'file.move',
  'file.delete',
  'git.status',
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
  ])
    if (typeof r[k] !== 'string' || !(r[k] as string).length) throw new Error(`Invalid ${k}`);
  if (r.executionMode !== 'sandbox' && r.executionMode !== 'host')
    throw new Error('Invalid executionMode');
  if (!Array.isArray(r.capabilityRoots)) throw new Error('Invalid capabilityRoots');
  return r as unknown as OperationEnvelope;
}
