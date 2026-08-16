import type { McpActivityLog } from './activity-log.js';

interface ActivityToken {
  id: string;
  startedAt: number;
  sessionId: string;
}

export class McpActivityRecorder {
  constructor(
    private readonly log?: McpActivityLog,
    private readonly sessions?: any,
  ) {}

  session(actor: string, sessionId: string, action: 'initialize' | 'disconnect') {
    this.log?.instant({
      actor,
      sessionId,
      workspaceId: this.workspaceId(sessionId),
      kind: 'session',
      action,
    });
  }

  begin(
    actor: string,
    sessionId: string,
    method: unknown,
    toolName: unknown,
    input?: unknown,
  ): ActivityToken | null {
    if (!this.log) return null;
    const methodName = typeof method === 'string' && method ? method : 'unknown';
    const action =
      methodName === 'tools/call'
        ? typeof toolName === 'string' && toolName
          ? toolName
          : 'unknown-tool'
        : methodName;
    const entry = this.log.begin({
      actor,
      sessionId,
      workspaceId: this.workspaceId(sessionId),
      kind: methodName === 'tools/call' ? 'tool' : 'rpc',
      action,
      input,
    });
    return { id: entry.id, startedAt: Date.now(), sessionId };
  }

  finish(token: ActivityToken | null, result: unknown) {
    if (!token) return;
    const value = result as { error?: unknown; result?: { isError?: unknown } } | null;
    const failed = Boolean(value?.error || value?.result?.isError);
    const output = value?.error ?? value?.result ?? result;
    this.complete(token, failed ? 'error' : 'success', output);
  }

  fail(token: ActivityToken | null, error?: unknown) {
    if (!token) return;
    const output =
      error instanceof Error
        ? { error: error.message }
        : error === undefined
          ? undefined
          : { error };
    this.complete(token, 'error', output);
  }

  private complete(token: ActivityToken, state: 'success' | 'error', output?: unknown) {
    this.log?.finish(
      token.id,
      state,
      Date.now() - token.startedAt,
      this.workspaceId(token.sessionId),
      output,
    );
  }

  private workspaceId(sessionId: string): string | undefined {
    return this.sessions?.activeLease?.(sessionId)?.workspaceId as string | undefined;
  }
}
