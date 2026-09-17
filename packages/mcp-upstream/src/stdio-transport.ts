import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PendingCalls } from './pending-calls.js';
import {
  MCP_PROTOCOL_VERSION,
  UpstreamError,
  parseJsonRpcMessage,
  type UpstreamErrorCode,
  type UpstreamServerInfo,
} from './protocol.js';
import { DEFAULT_DEADLINE_MS, type UpstreamTransport } from './transport.js';

const STDERR_LIMIT = 8_000;

export interface StdioTransportOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  deadlineMs?: number;
}

export class StdioTransport implements UpstreamTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private stderrBuffer = '';
  private ready = false;
  private handler: (method: string, params: unknown) => void = () => {};
  private closedHandler: () => void = () => {};
  private readonly calls: PendingCalls;

  constructor(private readonly options: StdioTransportOptions) {
    this.calls = new PendingCalls(options.deadlineMs ?? DEFAULT_DEADLINE_MS, () => {
      this.teardown('UPSTREAM_TIMEOUT', 'The upstream server was killed after a timeout', true);
    });
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.handler = handler;
  }

  onClose(handler: () => void): void {
    this.closedHandler = handler;
  }

  diagnostics(): string {
    return this.stderrBuffer;
  }

  async connect(): Promise<UpstreamServerInfo> {
    if (this.child) await this.close();
    this.start();
    const result = (await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'aevra', version: '1' },
    })) as {
      protocolVersion?: string;
      serverInfo?: { name?: string; version?: string };
      capabilities?: Record<string, unknown>;
    };
    this.ready = true;
    this.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return {
      name: result.serverInfo?.name ?? 'unknown',
      version: result.serverInfo?.version ?? '0.0.0',
      protocolVersion: result.protocolVersion ?? MCP_PROTOCOL_VERSION,
      capabilities: result.capabilities ?? {},
    };
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.child || (!this.ready && method !== 'initialize'))
      throw new UpstreamError('UPSTREAM_DIED', 'The upstream server is not initialized');
    const { id, promise } = this.calls.issue<unknown>(method);
    this.write({ jsonrpc: '2.0', id, method, params });
    return promise;
  }

  async close(): Promise<void> {
    this.teardown('UPSTREAM_DIED', 'The upstream server was stopped', true);
  }

  private start(): ChildProcessWithoutNullStreams {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.options.command, this.options.args, {
        stdio: 'pipe',
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
      });
    } catch (error) {
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        `Could not start ${this.options.command}`,
        {
          cause: error instanceof Error ? error.name : 'unknown',
        },
      );
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child === child) this.absorb(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      if (this.child === child)
        this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-STDERR_LIMIT);
    });
    child.stdin.on('error', () => {});
    child.on('exit', () => {
      if (this.child === child) this.teardown('UPSTREAM_DIED', 'The upstream server exited');
    });
    child.on('error', () => {
      if (this.child === child)
        this.teardown('UPSTREAM_CONNECT_FAILED', 'The upstream server could not start');
    });
    this.child = child;
    return child;
  }

  private write(message: unknown): void {
    const child = this.child;
    if (!child) throw new UpstreamError('UPSTREAM_DIED', 'The upstream server is not running');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private absorb(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf('\n');
      const message = parseJsonRpcMessage(line);
      if (!message) continue;
      if (message.type === 'response') this.calls.settle(message.response);
      else this.handler(message.notification.method, message.notification.params);
    }
  }

  private teardown(code: UpstreamErrorCode, message: string, terminate = false): void {
    const child = this.child;
    if (terminate && child && !child.killed) child.kill();
    this.child = null;
    this.ready = false;
    this.buffer = '';
    this.calls.failAll(code, message);
    if (child) this.closedHandler();
  }
}
