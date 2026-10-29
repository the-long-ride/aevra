import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AevraToolError } from '../../../../packages/mcp-tools/src/errors.js';
import type {
  TransferLinkInput,
  TransferLinkPort,
} from '../../../../packages/mcp-tools/src/transfer-link-port.js';

const LINK_TTL_MS = 5 * 60_000;
const MAX_PENDING_LINKS = 512;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface LinkRecord extends TransferLinkInput {
  id: string;
}

interface StoredLink extends LinkRecord {
  hash: string;
  expiresAtMs: number;
  state: 'ready' | 'inflight';
}

function digest(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * In-memory one-time download links (R5). The secret is 32 random bytes, handed out once
 * inside the url and kept only as a sha256. A link is single use: `claim` marks it in
 * flight atomically (the event loop makes the check and the mark one step), so a concurrent
 * second claim gets null. Nothing here is persisted or logged.
 */
export class TransferLinkStore implements TransferLinkPort {
  private readonly byHash = new Map<string, StoredLink>();

  constructor(
    private readonly publicUrl: () => string | undefined,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = LINK_TTL_MS,
  ) {}

  canMint(): boolean {
    return Boolean(this.publicUrl()?.trim());
  }

  mint(input: TransferLinkInput): { id: string; url: string; expiresAt: string } {
    const base = this.publicUrl()?.trim();
    if (!base) {
      throw new AevraToolError('PUBLIC_URL_REQUIRED', 'No public URL is configured for links');
    }
    this.sweep();
    if (this.byHash.size >= MAX_PENDING_LINKS) {
      throw new AevraToolError('INVALID_REQUEST', 'Too many pending links');
    }
    const secret = randomBytes(32).toString('base64url');
    const hash = digest(secret);
    const expiresAtMs = this.now() + this.ttlMs;
    const id = `lnk_${randomUUID()}`;
    this.byHash.set(hash, { ...input, id, hash, expiresAtMs, state: 'ready' });
    return {
      id,
      url: `${base.replace(/\/+$/, '')}/files/${secret}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /** Takes the link for one transfer; null when unknown, expired, used, revoked or in flight. */
  claim(secret: string): LinkRecord | null {
    if (typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) return null;
    const hash = digest(secret);
    const stored = this.byHash.get(hash);
    if (!stored) return null;
    if (stored.expiresAtMs <= this.now()) {
      this.byHash.delete(hash);
      return null;
    }
    if (stored.state !== 'ready') return null;
    stored.state = 'inflight';
    const { hash: _hash, expiresAtMs: _expires, state: _state, ...record } = stored;
    return record;
  }

  /** The transfer finished: the link is spent. */
  complete(id: string): void {
    const stored = this.find(id);
    if (stored) this.byHash.delete(stored.hash);
  }

  /** The transfer aborted: the link may be tried again until it expires. */
  release(id: string): void {
    const stored = this.find(id);
    if (!stored) return;
    if (stored.expiresAtMs <= this.now()) this.byHash.delete(stored.hash);
    else stored.state = 'ready';
  }

  /**
   * False once the link is spent, released or revoked; a streaming route polls this. Expiry is
   * only checked at claim time: a transfer that started in time may finish after the ttl.
   */
  isActive(id: string): boolean {
    const stored = this.find(id);
    if (!stored) return false;
    return stored.state === 'inflight' || stored.expiresAtMs > this.now();
  }

  revokeByConnection(connectionId: string): number {
    let count = 0;
    for (const [hash, stored] of this.byHash) {
      if (stored.connectionId !== connectionId) continue;
      this.byHash.delete(hash);
      count += 1;
    }
    return count;
  }

  private find(id: string): StoredLink | undefined {
    for (const stored of this.byHash.values()) if (stored.id === id) return stored;
    return undefined;
  }

  /**
   * Drops expired links that were never claimed. An in-flight link is never swept: it ends via
   * complete, release or revoke, and the route always reaches one of them (a dead client
   * closes the response). The pending cap still bounds memory.
   */
  private sweep() {
    const now = this.now();
    for (const [hash, stored] of this.byHash) {
      if (stored.state === 'ready' && stored.expiresAtMs <= now) this.byHash.delete(hash);
    }
  }
}
