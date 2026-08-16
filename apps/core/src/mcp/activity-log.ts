import { randomUUID } from 'node:crypto';
import { sanitizeStructuredSecrets } from '../../../../packages/security/src/dlp.js';

export type McpActivityKind = 'tool' | 'rpc' | 'session';
export type McpActivityState = 'running' | 'success' | 'error';

const MAX_ACTIVITY_DETAIL_CHARS = 12_000;

function activityDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const serialized = JSON.stringify(sanitizeStructuredSecrets(value), null, 2);
    if (serialized === undefined) return undefined;
    if (serialized.length <= MAX_ACTIVITY_DETAIL_CHARS) return serialized;
    return `${serialized.slice(0, MAX_ACTIVITY_DETAIL_CHARS)}\n… [truncated]`;
  } catch {
    return '[UNAVAILABLE]';
  }
}

export interface McpActivityEntry {
  id: string;
  startedAt: string;
  updatedAt: string;
  actor: string;
  sessionId: string;
  workspaceId?: string;
  kind: McpActivityKind;
  action: string;
  state: McpActivityState;
  durationMs?: number;
  input?: string;
  output?: string;
}

export interface McpActivityInput {
  actor: string;
  sessionId: string;
  workspaceId?: string;
  kind: McpActivityKind;
  action: string;
  input?: unknown;
}

type Listener = (entry: McpActivityEntry) => void;

export class McpActivityLog {
  private entries: McpActivityEntry[] = [];
  private listeners = new Set<Listener>();

  constructor(private readonly maxEntries = 200) {}

  begin(input: McpActivityInput): McpActivityEntry {
    const now = new Date().toISOString();
    const detail = activityDetail(input.input);
    const entry: McpActivityEntry = {
      id: `op_${randomUUID()}`,
      startedAt: now,
      updatedAt: now,
      actor: input.actor,
      sessionId: input.sessionId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      kind: input.kind,
      action: input.action,
      state: 'running',
      ...(detail !== undefined ? { input: detail } : {}),
    };
    this.entries.push(entry);
    this.trim();
    this.emit(entry);
    return { ...entry };
  }

  finish(
    id: string,
    state: Extract<McpActivityState, 'success' | 'error'>,
    durationMs: number,
    workspaceId?: string,
    output?: unknown,
  ): McpActivityEntry | null {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const current = this.entries[index]!;
    const detail = activityDetail(output);
    const updated: McpActivityEntry = {
      ...current,
      updatedAt: new Date().toISOString(),
      state,
      durationMs: Math.max(0, Math.round(durationMs)),
      ...(workspaceId ? { workspaceId } : {}),
      ...(detail !== undefined ? { output: detail } : {}),
    };
    this.entries[index] = updated;
    this.emit(updated);
    return { ...updated };
  }

  instant(input: McpActivityInput): McpActivityEntry {
    const now = new Date().toISOString();
    const detail = activityDetail(input.input);
    const entry: McpActivityEntry = {
      id: `op_${randomUUID()}`,
      startedAt: now,
      updatedAt: now,
      actor: input.actor,
      sessionId: input.sessionId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      kind: input.kind,
      action: input.action,
      state: 'success',
      durationMs: 0,
      ...(detail !== undefined ? { input: detail } : {}),
    };
    this.entries.push(entry);
    this.trim();
    this.emit(entry);
    return { ...entry };
  }

  recent(limit = this.maxEntries): McpActivityEntry[] {
    return this.entries.slice(-Math.max(0, limit)).map((entry) => ({ ...entry }));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private trim() {
    const overflow = this.entries.length - Math.max(1, this.maxEntries);
    if (overflow > 0) this.entries.splice(0, overflow);
  }

  private emit(entry: McpActivityEntry) {
    for (const listener of this.listeners) listener({ ...entry });
  }
}
