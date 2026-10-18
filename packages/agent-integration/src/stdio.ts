import type { Readable, Writable } from 'node:stream';

export interface StdioIo {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}
export interface StdioTransport {
  send(
    message: unknown,
    emit: (message: unknown) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
  close?(): Promise<void>;
}

// Abort reasons. A request the client cancelled gets no reply: MCP says the receiver should not
// answer a cancelled request, and the client has already stopped waiting for it.
const CANCELLED = 'cancelled',
  TIMED_OUT = 'timed-out';
const MAX_IN_FLIGHT = 32,
  MAX_WAITING = 256;

export async function runStdio(
  io: StdioIo,
  transport: StdioTransport,
  // No default time limit: long tool calls (shell_run, process_wait) run as long as over HTTP,
  // and the client ends a request it no longer wants with notifications/cancelled.
  options: { maxLineBytes?: number; timeoutMs?: number } = {},
): Promise<number> {
  const max = options.maxLineBytes ?? 8 * 1024 * 1024;
  const pending = new Set<Promise<void>>();
  const controllers = new Map<string, AbortController>();
  let output = Promise.resolve(),
    handshake: Promise<void> | null = null;
  let failed = false,
    transportFailed = false,
    buffer = Buffer.alloc(0),
    overflow = false;
  const outputError = () => {
    failed = true;
    for (const controller of controllers.values()) controller.abort();
    io.stdin.destroy();
  };
  io.stdout.on('error', outputError);
  const emit = (message: unknown): Promise<void> => {
    const text = JSON.stringify(message);
    if (Buffer.byteLength(text) > 8 * 1024 * 1024)
      return Promise.reject(new Error('MCP response exceeds frame limit'));
    output = output.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (failed) return resolve();
          io.stdout.write(text + '\n', (error) => (error ? reject(error) : resolve()));
        }),
    );
    return output;
  };
  const error = (id: unknown, code: number, message: string) =>
    emit({ jsonrpc: '2.0', id, error: { code, message } });
  // A reply nobody awaits: a broken stdout already set `failed` (the stdout `error` listener),
  // so its rejection is dropped here instead of becoming an unhandled rejection.
  const reply = (id: unknown, code: number, message: string) => {
    error(id, code, message).catch(() => undefined);
  };
  const handle = (line: Buffer) => {
    if (!line.toString().trim()) return;
    let message: any;
    try {
      message = JSON.parse(line.toString('utf8'));
    } catch {
      reply(null, -32700, 'Parse error');
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      reply(null, -32600, 'Invalid Request');
      return;
    }
    if (message.method === 'notifications/cancelled')
      controllers.get(JSON.stringify(message.params?.requestId))?.abort(CANCELLED);
    const controller = new AbortController();
    const key = Object.hasOwn(message, 'id') ? JSON.stringify(message.id) : undefined;
    if (key && controllers.has(key)) {
      reply(message.id, -32600, 'Duplicate in-flight request id');
      return;
    }
    if (key) controllers.set(key, controller);
    const timeout = options.timeoutMs
      ? setTimeout(() => controller.abort(TIMED_OUT), options.timeoutMs)
      : undefined;
    const prior = handshake;
    const task = (async () => {
      if (prior && message.method !== 'notifications/cancelled') await prior;
      await transport.send(message, emit, controller.signal);
    })()
      .catch(async () => {
        const { aborted, reason } = controller.signal;
        if (!aborted) {
          transportFailed = true;
          io.stderr.write(
            'MCP transport unavailable. For root Aevra, start the core with aevra start; check the credential if access was revoked.\n',
          );
        }
        if (key && reason !== CANCELLED)
          await error(
            message.id,
            -32000,
            !aborted
              ? 'MCP transport unavailable'
              : reason === TIMED_OUT
                ? 'Request timed out'
                : 'Request cancelled',
          );
        else if (!key) io.stderr.write('MCP notification delivery failed\n');
      })
      .finally(() => {
        if (timeout) clearTimeout(timeout);
        if (key) controllers.delete(key);
        pending.delete(task);
        const next = waiting.shift();
        if (next) handle(next.line);
      });
    if (message.method === 'initialize') handshake = task;
    pending.add(task);
  };
  // At the in-flight cap, stdin keeps being read: requests wait their turn, while a cancellation
  // is acted on at once (a waiting request it names is dropped without a reply).
  const waiting: { line: Buffer; key: string | undefined }[] = [];
  const admit = (line: Buffer) => {
    if (pending.size < MAX_IN_FLIGHT) return handle(line);
    let message: any;
    try {
      message = JSON.parse(line.toString('utf8'));
    } catch {
      return handle(line);
    }
    if (message?.method === 'notifications/cancelled') {
      const target = JSON.stringify(message.params?.requestId);
      const index = waiting.findIndex((item) => item.key === target);
      if (index >= 0) waiting.splice(index, 1);
      else controllers.get(target)?.abort(CANCELLED);
      return;
    }
    const key = message && Object.hasOwn(message, 'id') ? JSON.stringify(message.id) : undefined;
    if (waiting.length >= MAX_WAITING) {
      if (key) reply(message.id, -32000, 'Too many requests in flight');
      return;
    }
    waiting.push({ line, key });
  };
  try {
    for await (const chunk of io.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let start = 0;
      while (start < bytes.length) {
        const newline = bytes.indexOf(10, start);
        const part = bytes.subarray(start, newline < 0 ? bytes.length : newline);
        if (!overflow && buffer.length + part.length > max) {
          buffer = Buffer.alloc(0);
          overflow = true;
        }
        if (!overflow) buffer = Buffer.concat([buffer, part]);
        if (newline < 0) break;
        if (overflow) await error(null, -32600, `Request exceeds ${max} bytes`);
        else admit(buffer);
        buffer = Buffer.alloc(0);
        overflow = false;
        start = newline + 1;
      }
    }
    if (overflow) await error(null, -32600, `Request exceeds ${max} bytes`);
    else admit(buffer);
    // End of input still lets running calls answer: a piped one-shot request expects its reply.
    while (pending.size || waiting.length) await Promise.race(pending);
    await output;
  } catch {
    failed = true;
  } finally {
    for (const controller of controllers.values()) controller.abort();
    await transport.close?.().catch(() => undefined);
    io.stdout.off('error', outputError);
  }
  return failed || transportFailed ? 1 : 0;
}
