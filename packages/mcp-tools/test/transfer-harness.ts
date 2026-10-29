import { createHash } from 'node:crypto';
import { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import { AuditService } from '../../../apps/core/src/audit/audit-service.js';
import { TransferLinkStore } from '../../../apps/core/src/files/transfer-links.js';
import { ApprovalRepository } from '../../store/src/approvals.js';
import { AuditRepository } from '../../store/src/audit.js';
import { AevraDatabase } from '../../store/src/database.js';
import { McpToolService } from '../src/service.js';

export const MB = 1024 * 1024;

export interface HarnessOptions {
  yolo?: 'off' | 'prevent-high-risk' | 'do-whatever';
  limits?: { maxFileMb: number; maxBatchMb: number; inlineMb: number };
  hook?: boolean;
  /** Event the observing hook listens on; default before_tool_call. */
  hookEvent?: string;
  noUploadStream?: boolean;
  /** Existing files: logical path to size in bytes. */
  existing?: Record<string, number>;
  disabled?: string[];
  /** Files the agent may pull (files_upload): logical path to bytes and sniffed type. */
  readable?: Record<string, { data: Buffer; mimeType?: string | null }>;
  /** Public base URL for one-time links; absent means no public exposure. */
  publicUrl?: string;
  noDownloadStream?: boolean;
  /** Error code the fake executor gives a missing path (the real one passes raw fs codes). */
  missingCode?: string;
  /** Remembered DENY on these capabilities. */
  deny?: string[];
}

export function b64(text: string) {
  return Buffer.from(text).toString('base64');
}

export function sha(data: Buffer) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

export function makeHarness(options: HarnessOptions = {}) {
  const db = AevraDatabase.open(':memory:');
  const audit = new AuditService(new AuditRepository(db.raw()));
  const approvals = new ApprovalService(new ApprovalRepository(db.raw()), audit, {
    fastWaitMs: 0,
    lifetimeMs: 300_000,
    lifetimeByRiskMs: {},
  });
  const requests: any[] = [];
  const originalRequest = approvals.request.bind(approvals);
  (approvals as any).request = async (input: any, volatile?: unknown) => {
    requests.push(input);
    return originalRequest(input, volatile);
  };

  const files = new Map<string, Buffer>();
  const sizes = new Map<string, number>();
  for (const [name, size] of Object.entries(options.existing ?? {})) {
    files.set(name, Buffer.alloc(0));
    sizes.set(name, size);
  }
  const ops: any[] = [];
  const hookPayloads: unknown[] = [];
  const snapshots: string[] = [];
  const discarded: string[] = [];
  const mutations: any[] = [];

  const done = (path: string, data: Buffer, mimeType: string) => ({
    ok: true,
    value: {
      path,
      bytes: data.length,
      sha256: sha(data),
      mimeType,
      mimeMismatch: false,
      recoverable: true,
    },
  });
  const fail = (code: string, message: string) => ({ ok: false, error: { code, message } });

  const worker: any = {
    async execute(input: any) {
      const op = input.operation;
      if (op.kind === 'hook.run') {
        hookPayloads.push(op.payload);
        return { ok: true, value: { exitCode: 0, stdout: '' } };
      }
      ops.push(op);
      if (op.kind === 'files.upload.stat') {
        const readable = options.readable?.[op.path];
        if (readable) {
          return {
            ok: true,
            value: {
              bytes: readable.data.length,
              sha256: sha(readable.data),
              mtimeMs: 1,
              mimeType: readable.mimeType ?? null,
            },
          };
        }
        if (!files.has(op.path))
          return fail(options.missingCode ?? 'NOT_FOUND', 'ENOENT: /host/secret/dir/missing');
        return {
          ok: true,
          value: {
            bytes: sizes.get(op.path) ?? 1,
            ...(op.hash === false ? {} : { sha256: 'sha256:x' }),
            mtimeMs: 1,
          },
        };
      }
      if (op.kind === 'files.download.entry' && op.source.type === 'url') {
        if (op.source.url.includes('private')) return fail('URL_NOT_PUBLIC', 'not public');
        const data = Buffer.from('plain words from url');
        if (files.has(op.path) && !op.overwrite) return fail('FILE_EXISTS', 'exists');
        files.set(op.path, data);
        return done(op.path, data, op.mimeType);
      }
      return fail('INVALID_REQUEST', `unexpected ${op.kind}`);
    },
    async executeWithUpload(input: any, source: AsyncIterable<Uint8Array>) {
      const op = input.operation;
      ops.push(op);
      const parts: Buffer[] = [];
      for await (const chunk of source) parts.push(Buffer.from(chunk));
      const data = Buffer.concat(parts);
      if (data.length > op.maxBytes) return fail('SIZE_LIMIT', 'too big');
      if (files.has(op.path) && !op.overwrite) return fail('FILE_EXISTS', 'exists');
      files.set(op.path, data);
      return done(op.path, data, op.mimeType);
    },
    async executeWithDownload(input: any) {
      const op = input.operation;
      ops.push(op);
      const readable = options.readable?.[op.path];
      const empty = (async function* () {})();
      if (!readable) return { result: Promise.resolve(fail('NOT_FOUND', 'missing')), body: empty };
      if (op.sha256 !== sha(readable.data)) {
        return { result: Promise.resolve(fail('FILE_CHANGED', 'changed')), body: empty };
      }
      const data = readable.data;
      const body = (async function* () {
        for (let at = 0; at < data.length; at += 64 * 1024) yield data.subarray(at, at + 64 * 1024);
      })();
      return {
        result: Promise.resolve({ ok: true, value: { bytes: data.length, sha256: sha(data) } }),
        body,
      };
    },
  };
  if (options.noUploadStream) delete worker.executeWithUpload;
  if (options.noDownloadStream) delete worker.executeWithDownload;

  const lease: any = {
    id: 'l1',
    workspaceId: 'w1',
    actor: 'connector:test',
    capabilities: ['files.read'],
    expiresAt: 'later',
  };
  const session: any = { id: 's1', actor: 'connector:test', subject: 'sub' };
  const sessions: any = {
    get: () => session,
    touch() {},
    activeLease: () => lease,
    leaseForWorkspace: (_s: string, id: string) => (id === lease.workspaceId ? lease : null),
    leases: () => [lease],
    isYolo: () => (options.yolo ?? 'off') !== 'off',
    isSwitching: () => false,
    connectionIdentity: () => ({ actor: session.actor, subject: session.subject }),
  };
  const workspaces: any = {
    getLocal: (value: string) =>
      value === 'w1' || value === 'One'
        ? { id: 'w1', name: 'One', description: 'd', hostRoot: '/root' }
        : null,
    capabilityRoots: () => [],
  };
  const hook = {
    id: 'observe',
    name: 'observe',
    event: options.hookEvent ?? 'before_tool_call',
    enabled: true,
    kind: 'command',
    execution: 'run',
    executable: 'node',
    args: [],
    permissions: ['observe'],
    timeoutMs: 1000,
    failurePolicy: 'continue',
  };
  const settings: any = {
    get: (key: string, fallback: unknown) => {
      if (key === 'files.transfer') return options.limits ?? fallback;
      if (key === 'policy.yolo') {
        const risk = options.yolo === 'do-whatever' ? 'do-whatever' : 'prevent-high-risk';
        return { mode: 'workspace', risk };
      }
      if (key === 'hooks.config') return options.hook ? [hook] : fallback;
      if (key === 'tools.disabled') return { names: options.disabled ?? [] };
      return fallback;
    },
  };
  const changes: any = {
    snapshot: async (_s: string, _w: string, path: string, operationId: string) => {
      snapshots.push(path);
      return { changeSet: { id: 'chg1' }, snapshotPath: `/snap/${operationId}`, sizeBytes: 1 };
    },
    discardSnapshot: async (_s: string, _w: string, snapshotPath: string) => {
      discarded.push(snapshotPath);
    },
    activeOrBegin: async () => ({ id: 'chg1' }),
    recordMutation: async (input: any) => {
      mutations.push(input);
    },
  };
  const links = new TransferLinkStore(() => options.publicUrl);
  const service = new McpToolService(sessions, workspaces, worker, { put() {} } as any, approvals, {
    settings,
    changes,
    audit,
    transferLinks: links,
    ...(options.deny
      ? {
          permissions: {
            decide: ({ capability }: any) =>
              options.deny!.includes(capability)
                ? { outcome: 'deny', reason: 'denied by rule' }
                : { outcome: 'allow' },
          },
        }
      : {}),
  } as any);
  return {
    service,
    approvals,
    db,
    audit,
    links,
    requests,
    files,
    ops,
    hookPayloads,
    snapshots,
    discarded,
    mutations,
    close: () => db.close(),
  };
}
