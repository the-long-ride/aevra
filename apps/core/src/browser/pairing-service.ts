import { randomInt } from 'node:crypto';
import { mintExtensionToken } from '../../../../packages/security/src/extension-token.js';
import type { SettingsRepository } from '../../../../packages/store/src/settings.js';
import type { WorkerGateway } from '../../../../packages/mcp-tools/src/service.js';

// Crockford-style: no I, L, O or U, so a code read off a screen is unambiguous.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 5 * 60_000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const EXTENSION_ID = /^[a-p]{32}$/;
const SETTINGS_KEY = 'browser.pairing';

export interface BrowserPairingState {
  extensionId: string | null;
  epoch: number;
  pairedAt: string | null;
  pendingCode: boolean;
  pendingExpiresAt: string | null;
}

interface StoredPairing {
  extensionId: string | null;
  epoch: number;
  pairedAt: string | null;
}

type SettingsLike = Pick<SettingsRepository, 'get' | 'set'>;

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, status: 400 });
}

function randomCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Owns pairing codes, the extension token, and the revocation epoch.
 *
 * Core mints; the worker verifies offline. The two share nothing beyond the
 * signed envelope, which is what lets the boundary test forbid core from
 * importing the browser package at all.
 */
export class BrowserPairingService {
  private pending: { code: string; expiresAt: number } | null = null;
  private stored: StoredPairing;

  constructor(
    private readonly settings: SettingsLike,
    private readonly worker: WorkerGateway,
    private readonly tokenKey: () => Buffer,
    private readonly options: { now?: () => number } = {},
  ) {
    this.stored = this.settings.get<StoredPairing>(SETTINGS_KEY, {
      extensionId: null,
      epoch: 1,
      pairedAt: null,
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  epoch(): number {
    return this.stored.epoch;
  }

  pairedExtensionId(): string | null {
    return this.stored.extensionId;
  }

  state(): BrowserPairingState {
    const pending = this.pending && this.pending.expiresAt > this.now() ? this.pending : null;
    return {
      extensionId: this.stored.extensionId,
      epoch: this.stored.epoch,
      pairedAt: this.stored.pairedAt,
      pendingCode: Boolean(pending),
      pendingExpiresAt: pending ? new Date(pending.expiresAt).toISOString() : null,
    };
  }

  /** Issuing a new code invalidates any outstanding one: at most one is live. */
  createCode(): { code: string; expiresAt: string } {
    const expiresAt = this.now() + CODE_TTL_MS;
    this.pending = { code: randomCode(), expiresAt };
    return { code: this.pending.code, expiresAt: new Date(expiresAt).toISOString() };
  }

  async redeem(code: string, extensionId: string): Promise<{ token: string; wsUrl: string }> {
    const pending = this.pending;
    // Consumed up front, so a wrong guess burns the code instead of leaving the
    // five-minute window open to repeated attempts.
    this.pending = null;
    if (
      !pending ||
      pending.expiresAt <= this.now() ||
      pending.code !== String(code).toUpperCase()
    ) {
      throw failure('PAIRING_CODE_INVALID', 'Pairing code is invalid or expired');
    }
    if (!EXTENSION_ID.test(String(extensionId))) {
      throw failure('EXTENSION_ID_INVALID', 'Extension id is not a Chromium extension id');
    }

    const issuedAt = this.now();
    this.persist({
      extensionId,
      epoch: this.stored.epoch,
      pairedAt: new Date(issuedAt).toISOString(),
    });
    const token = mintExtensionToken(this.tokenKey(), {
      extensionId,
      epoch: this.stored.epoch,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + TOKEN_TTL_MS).toISOString(),
    });
    const port = Number(process.env.AEVRA_BROWSER_PORT ?? 47833);
    await this.worker
      .execute({
        sessionId: 'admin:browser',
        workspaceId: 'system',
        roots: [],
        operation: {
          kind: 'browser.status',
          epoch: this.stored.epoch,
          extensionId,
        },
      })
      .catch(() => {
        // Worker might not be running or ready yet
      });
    return { token, wsUrl: `ws://127.0.0.1:${port}` };
  }

  /**
   * Kill switch. Bumping the epoch invalidates every issued token at once; the
   * envelope then tells the worker to drop live sockets immediately rather than
   * waiting for the next operation to notice.
   */
  async revokeAll(): Promise<BrowserPairingState> {
    this.persist({ ...this.stored, epoch: this.stored.epoch + 1 });
    await this.worker.execute({
      sessionId: 'admin:browser',
      workspaceId: 'system',
      roots: [],
      operation: { kind: 'browser.disconnect', all: true, epoch: this.stored.epoch },
    });
    return this.state();
  }

  private persist(next: StoredPairing): void {
    this.stored = next;
    this.settings.set(SETTINGS_KEY, next);
  }
}
