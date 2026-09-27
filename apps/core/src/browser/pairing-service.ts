import { randomInt, randomUUID } from 'node:crypto';
import { mintExtensionToken } from '../../../../packages/security/src/extension-token.js';
import type { SettingsRepository } from '../../../../packages/store/src/settings.js';
import type { WorkerGateway } from '../../../../packages/mcp-tools/src/service.js';
import type {
  BrowserControlHealth,
  BrowserControlSnapshot,
  BrowserPairingRecord,
} from '../../../../packages/admin-contracts/src/api-types.js';
import type { BrowserExtensionPairing } from '../../../../packages/protocol/src/browser.js';
import {
  asObject,
  fallbackProfileName,
  normalizeStoredPairing,
  PROFILE_ID,
  SETTINGS_KEY,
  type StoredPairing,
  type StoredRegistry,
  validExtensionId,
} from './pairing-storage.js';

// Crockford-style: no I, L, O or U, so a code read off a screen is unambiguous.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 5 * 60_000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

export type BrowserPairingSummary = BrowserPairingRecord;
export type BrowserPairingState = Omit<BrowserControlSnapshot, 'health'>;
export type BrowserPairingHealth = BrowserControlHealth;

type SettingsLike = Pick<SettingsRepository, 'get' | 'set'>;

function failure(code: string, message: string, status = 400): Error {
  return Object.assign(new Error(message), { code, status });
}

function randomCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Owns profile-level pairing records, one-use codes, and the global epoch.
 * Core mints credentials; the worker validates the signed envelope offline.
 */
export class BrowserPairingService {
  private pending: { code: string; expiresAt: number } | null = null;
  private stored: StoredRegistry;
  private lastSyncErrorCode: string | null = null;

  constructor(
    private readonly settings: SettingsLike,
    private readonly worker: WorkerGateway,
    private readonly tokenKey: () => Buffer,
    private readonly options: { now?: () => number } = {},
  ) {
    const loaded = this.settings.get<unknown>(SETTINGS_KEY, { epoch: 1, pairings: [] });
    this.stored = normalizeStoredPairing(loaded);
    if (!Array.isArray(asObject(loaded)?.pairings)) {
      this.settings.set(SETTINGS_KEY, this.stored);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  epoch(): number {
    return this.stored.epoch;
  }

  /** Most recently paired profile, kept as a compatibility alias. */
  pairedExtensionId(): string | null {
    return this.stored.pairings.at(-1)?.extensionId ?? null;
  }

  /** Internal worker authorization records; never return these from an API. */
  workerPairings(): BrowserExtensionPairing[] {
    return this.stored.pairings.map(
      ({ pairingId, profileId, profileName, extensionId, credentialId, legacy }) => ({
        pairingId,
        profileId,
        profileName,
        extensionId,
        credentialId,
        legacy,
      }),
    );
  }

  state(health?: BrowserPairingHealth | null): BrowserPairingState {
    const pending = this.pending && this.pending.expiresAt > this.now() ? this.pending : null;
    const activePairingId = health?.worker?.activePairingId ?? null;
    const mostRecent = this.stored.pairings.at(-1);
    return {
      pairings: this.stored.pairings.map((pairing) => ({
        pairingId: pairing.pairingId,
        profileId: pairing.profileId,
        profileName: pairing.profileName,
        extensionId: pairing.extensionId,
        pairedAt: pairing.pairedAt,
        connected: pairing.pairingId === activePairingId,
      })),
      extensionId: mostRecent?.extensionId ?? null,
      epoch: this.stored.epoch,
      pairedAt: mostRecent?.pairedAt ?? null,
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

  async redeem(input: {
    code: string;
    extensionId: string;
    profileId: string;
    profileName?: string;
  }): Promise<{ token: string; wsUrl: string }> {
    const pending = this.pending;
    // Consume up front so an invalid guess cannot keep a live code available.
    this.pending = null;
    if (
      !pending ||
      pending.expiresAt <= this.now() ||
      pending.code !== String(input.code).toUpperCase()
    ) {
      throw failure('PAIRING_CODE_INVALID', 'Pairing code is invalid or expired');
    }
    if (!validExtensionId(input.extensionId)) {
      throw failure('EXTENSION_ID_INVALID', 'Extension id is not a Chromium extension id');
    }
    if (!PROFILE_ID.test(String(input.profileId ?? ''))) {
      throw failure('PROFILE_ID_INVALID', 'Browser profile id is invalid');
    }

    const issuedAt = this.now();
    const profileId = input.profileId.toLowerCase();
    const credentialId = randomUUID();
    const profileName =
      typeof input.profileName === 'string' && input.profileName.trim()
        ? input.profileName.trim().slice(0, 120)
        : fallbackProfileName(profileId);
    const pairing: StoredPairing = {
      pairingId: profileId,
      profileId,
      profileName,
      extensionId: input.extensionId,
      credentialId,
      pairedAt: new Date(issuedAt).toISOString(),
      legacy: false,
    };
    const pairings = this.stored.pairings.filter((item) => item.profileId !== profileId);
    pairings.push(pairing);
    this.persist({ ...this.stored, pairings });

    const token = mintExtensionToken(this.tokenKey(), {
      extensionId: input.extensionId,
      profileId,
      credentialId,
      epoch: this.stored.epoch,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + TOKEN_TTL_MS).toISOString(),
    });
    const port = Number(process.env.AEVRA_BROWSER_PORT ?? 47833);
    await this.pairingHealth();
    return { token, wsUrl: `ws://127.0.0.1:${port}` };
  }

  async pairingHealth(): Promise<BrowserPairingHealth> {
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const worker = await this.syncWorker();
      this.lastSyncErrorCode = null;
      const activeId = worker?.activePairingId;
      const activeName = worker?.activeProfileName?.trim();
      if (activeId && activeName) {
        const active = this.stored.pairings.find((item) => item.pairingId === activeId);
        if (active && active.profileName !== activeName) {
          this.persist({
            ...this.stored,
            pairings: this.stored.pairings.map((item) =>
              item.pairingId === activeId
                ? { ...item, profileName: activeName.slice(0, 120) }
                : item,
            ),
          });
        }
      }
      return {
        coreExtensionId: this.pairedExtensionId(),
        coreEpoch: this.stored.epoch,
        worker,
        syncErrorCode: this.lastSyncErrorCode,
        syncCheckedAt: checkedAt,
      };
    } catch (error) {
      const code = String((error as { code?: string }).code ?? 'WORKER_UNAVAILABLE');
      this.lastSyncErrorCode = [
        'WORKER_UNAVAILABLE',
        'WORKER_TIMEOUT',
        'BROWSER_UNAVAILABLE',
      ].includes(code)
        ? code
        : 'WORKER_UNAVAILABLE';
      return {
        coreExtensionId: this.pairedExtensionId(),
        coreEpoch: this.stored.epoch,
        worker: null,
        syncErrorCode: this.lastSyncErrorCode,
        syncCheckedAt: checkedAt,
      };
    }
  }

  async unpair(pairingId: string): Promise<BrowserPairingState> {
    const pairings = this.stored.pairings.filter((item) => item.pairingId !== pairingId);
    if (pairings.length === this.stored.pairings.length) {
      throw failure('BROWSER_PAIRING_NOT_FOUND', 'Browser pairing was not found', 404);
    }
    this.persist({ ...this.stored, pairings });
    try {
      const worker = await this.syncWorker();
      this.lastSyncErrorCode = null;
      return this.state({
        coreExtensionId: this.pairedExtensionId(),
        coreEpoch: this.stored.epoch,
        worker,
        syncErrorCode: null,
        syncCheckedAt: new Date(this.now()).toISOString(),
      });
    } catch {
      this.lastSyncErrorCode = 'BROWSER_PAIRING_SYNC_PENDING';
      throw failure(
        'BROWSER_PAIRING_SYNC_PENDING',
        'The pairing was removed, but the worker has not confirmed the revocation yet. Refresh settings after the worker reconnects.',
        503,
      );
    }
  }

  /** Kill switch invalidates all issued tokens by advancing the global epoch. */
  async revokeAll(): Promise<BrowserPairingState> {
    this.persist({ epoch: this.stored.epoch + 1, pairings: [] });
    const result = await this.worker.execute({
      sessionId: 'admin:browser',
      workspaceId: 'system',
      roots: [],
      operation: {
        kind: 'browser.disconnect',
        all: true,
        epoch: this.stored.epoch,
        pairings: [],
      },
    });
    if (!result.ok) {
      throw failure(
        'BROWSER_PAIRING_SYNC_PENDING',
        'All pairings were removed, but the worker has not confirmed the disconnect yet.',
        503,
      );
    }
    return this.state();
  }

  private async syncWorker(): Promise<BrowserPairingHealth['worker']> {
    const result = await this.worker.execute({
      sessionId: 'admin:browser',
      workspaceId: 'system',
      roots: [],
      operation: {
        kind: 'browser.status',
        epoch: this.stored.epoch,
        extensionId: this.pairedExtensionId() ?? '',
        pairings: this.workerPairings(),
      },
    });
    if (!result.ok) {
      throw Object.assign(new Error('Worker browser pairing sync failed'), {
        code: result.error.code,
      });
    }
    return result.value as BrowserPairingHealth['worker'];
  }

  private persist(next: StoredRegistry): void {
    this.settings.set(SETTINGS_KEY, next);
    this.stored = next;
  }
}
