import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createIpcServer, type RpcHandler } from '../src/server.js';
import { SocketWorkerClient } from '../src/client.js';
import { encodeFrame, FrameDecoder } from '../src/framing.js';
import { handshakeMac } from '../src/envelope.js';
import { after } from 'node:test';

export const MiB = 1024 * 1024;

/** A failed assertion must not leave a listening server holding the test process open. */
const openRigs = new Set<{ close(): Promise<void> }>();
after(async () => {
  for (const rig of openRigs) await rig.close();
});
export const SECRET = Buffer.alloc(32, 7);

export const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A minimal envelope: the IPC layer only reads `operation` for its deadline. */
export const env = (kind: string, extra: Record<string, unknown> = {}) =>
  ({ operation: { kind, ...extra } }) as any;

export interface Rig {
  endpoint: string;
  client: SocketWorkerClient;
  close(): Promise<void>;
}

export async function startRig(handler: Partial<RpcHandler> & Pick<RpcHandler, 'execute'>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-stream-'));
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\aevra-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`
      : path.join(dir, `s-${Math.random().toString(36).slice(2)}.sock`);
  const server = createIpcServer(endpoint, SECRET, 'd', {
    health: async () => ({ ready: true, pid: 1 }),
    ...handler,
  });
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(endpoint, res);
  });
  const client = new SocketWorkerClient(endpoint, SECRET, 'd');
  const peers: net.Socket[] = [];
  const rig: Rig & { track(socket: net.Socket): void } = {
    endpoint,
    client,
    track: (socket) => void peers.push(socket),
    async close() {
      await client.close();
      for (const p of peers) p.destroy();
      await new Promise<void>((res) => server.close(() => res()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
  openRigs.add(rig);
  return rig;
}

/** Deterministic bytes so both ends can be checked against one digest. */
export async function* generate(
  total: number,
  chunk: number,
  onChunk?: () => void,
): AsyncGenerator<Uint8Array> {
  let sent = 0;
  while (sent < total) {
    const len = Math.min(chunk, total - sent);
    const b = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) b[i] = (sent + i) % 251;
    sent += len;
    onChunk?.();
    yield b;
  }
}

export async function digestOf(source: AsyncIterable<Uint8Array>) {
  const h = createHash('sha256');
  let bytes = 0;
  for await (const c of source) {
    h.update(c);
    bytes += c.length;
  }
  return { bytes, sha: h.digest('hex') };
}

/** A bare socket that can speak (or skip) the handshake, for hostile-peer tests. */
export async function rawPeer(
  rig: { endpoint: string; track(s: net.Socket): void },
  handshake = true,
) {
  const socket = net.createConnection(rig.endpoint);
  rig.track(socket);
  const decoder = new FrameDecoder();
  const frames: any[] = [];
  let closed = false;
  socket.on('data', (c) => frames.push(...decoder.push(c)));
  socket.on('error', () => {});
  socket.on('close', () => {
    closed = true;
  });
  await new Promise<void>((res) => socket.once('connect', res));
  const peer = {
    frames,
    get closed() {
      return closed;
    },
    send: (frame: unknown) => socket.write(encodeFrame(frame)),
    async waitFor(pred: (f: any) => boolean, ms = 3000) {
      const end = Date.now() + ms;
      for (;;) {
        const hit = frames.find(pred);
        if (hit) return hit;
        if (Date.now() > end) throw new Error('timed out waiting for frame');
        await sleep(10);
      }
    },
    async waitClosed(ms = 3000) {
      const end = Date.now() + ms;
      while (!closed && Date.now() < end) await sleep(10);
      return closed;
    },
  };
  if (handshake) {
    peer.send({ type: 'hello', daemonInstanceId: 'd', challengeA: 'aa' });
    const ack = await peer.waitFor((f) => f.type === 'helloAck');
    peer.send({
      type: 'ready',
      challengeB: ack.challengeB,
      mac: handshakeMac(SECRET, 'd', ack.challengeB),
    });
  }
  return peer;
}
