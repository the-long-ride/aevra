import type { Readable, Writable } from 'node:stream';

export const DEFAULT_REQUEST_TIMEOUT_MS = 600_000;

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

export async function runStdio(
  io: StdioIo,
  transport: StdioTransport,
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
      controllers.get(JSON.stringify(message.params?.requestId))?.abort();
    const controller = new AbortController();
    const key = Object.hasOwn(message, 'id') ? JSON.stringify(message.id) : undefined;
    if (key && controllers.has(key)) {
      reply(message.id, -32600, 'Duplicate in-flight request id');
      return;
    }
    if (key) controllers.set(key, controller);
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    const prior = handshake;
    const task = (async () => {
      if (prior && message.method !== 'notifications/cancelled') await prior;
      await transport.send(message, emit, controller.signal);
    })()
      .catch(async () => {
        if (!controller.signal.aborted) {
          transportFailed = true;
          io.stderr.write(
            'MCP transport unavailable. For root Aevra, start the core with aevra start; check the credential if access was revoked.\n',
          );
        }
        if (key)
          await error(
            message.id,
            -32000,
            controller.signal.aborted
              ? 'Request cancelled or timed out'
              : 'MCP transport unavailable',
          );
        else io.stderr.write('MCP notification delivery failed\n');
      })
      .finally(() => {
        clearTimeout(timeout);
        if (key) controllers.delete(key);
        pending.delete(task);
      });
    if (message.method === 'initialize') handshake = task;
    pending.add(task);
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
        else handle(buffer);
        buffer = Buffer.alloc(0);
        overflow = false;
        start = newline + 1;
        if (pending.size >= 32) await Promise.race(pending);
      }
    }
    if (overflow) await error(null, -32600, `Request exceeds ${max} bytes`);
    else handle(buffer);
    await Promise.all(pending);
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
