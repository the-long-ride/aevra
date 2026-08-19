export type McpDiagnosticHint =
  | 'no-client-traffic'
  | 'initialized-no-tools'
  | 'active'
  | 'stopped';

export interface McpDiagnosticSnapshot {
  state: 'listening' | 'stopped';
  startedAt: string | null;
  requestCount: number;
  initializeCount: number;
  toolCallCount: number;
  lastInboundAt: string | null;
  lastMethod: string | null;
  lastActor: string | null;
  lastSessionId: string | null;
  lastToolName: string | null;
  hint: McpDiagnosticHint;
}

export class McpDiagnostics {
  private state: 'listening' | 'stopped' = 'stopped';
  private startedAt: string | null = null;
  private requestCount = 0;
  private initializeCount = 0;
  private toolCallCount = 0;
  private lastInboundAt: string | null = null;
  private lastMethod: string | null = null;
  private lastActor: string | null = null;
  private lastSessionId: string | null = null;
  private lastToolName: string | null = null;

  listening() {
    this.state = 'listening';
    this.startedAt = new Date().toISOString();
  }

  stopped() {
    this.state = 'stopped';
  }

  recordInbound(httpMethod: string) {
    this.requestCount++;
    this.lastInboundAt = new Date().toISOString();
    this.lastMethod = `http:${httpMethod.toUpperCase()}`;
  }

  recordMethod(method: unknown) {
    if (typeof method !== 'string' || !method) return;
    this.lastMethod = method;
    if (method === 'initialize') this.initializeCount++;
  }

  recordIdentity(actor: string, sessionId?: string) {
    this.lastActor = actor;
    if (sessionId) this.lastSessionId = sessionId;
  }

  recordToolCall(toolName: unknown, sessionId: string) {
    this.toolCallCount++;
    this.lastSessionId = sessionId;
    this.lastToolName = typeof toolName === 'string' ? toolName : null;
  }

  snapshot(): McpDiagnosticSnapshot {
    return {
      state: this.state,
      startedAt: this.startedAt,
      requestCount: this.requestCount,
      initializeCount: this.initializeCount,
      toolCallCount: this.toolCallCount,
      lastInboundAt: this.lastInboundAt,
      lastMethod: this.lastMethod,
      lastActor: this.lastActor,
      lastSessionId: this.lastSessionId,
      lastToolName: this.lastToolName,
      hint: this.hint(),
    };
  }

  private hint(): McpDiagnosticHint {
    if (this.state === 'stopped') return 'stopped';
    if (this.requestCount === 0) return 'no-client-traffic';
    if (this.initializeCount > 0 && this.toolCallCount === 0) return 'initialized-no-tools';
    return 'active';
  }
}
