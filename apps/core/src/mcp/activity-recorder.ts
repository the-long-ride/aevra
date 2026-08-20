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
    });
    return { id: entry.id, startedAt: Date.now(), sessionId };
  }

  finish(token: ActivityToken | null, result: unknown) {
    if (!token) return;
    const value = result as { error?: unknown; result?: { isError?: unknown } } | null;
    const failed = Boolean(value?.error || value?.result?.isError);
    this.complete(token, failed ? 'error' : 'success');
  }

  fail(token: ActivityToken | null) {
    if (token) this.complete(token, 'error');
  }

  private complete(token: ActivityToken, state: 'success' | 'error') {
    this.log?.finish(
      token.id,
      state,
      Date.now() - token.startedAt,
      this.workspaceId(token.sessionId),
    );
  }

  private workspaceId(sessionId: string): string | undefined {
    return this.sessions?.activeLease?.(sessionId)?.workspaceId as string | undefined;
  }
}
