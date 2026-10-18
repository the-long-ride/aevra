import { createHash, randomBytes } from 'node:crypto';

export const DEVICE_COOKIE = 'aevra_device';
const DEVICE_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_DEVICES = 64;

interface KnownDevicesOptions {
  ttlMs?: number;
  maxDevices?: number;
  now?: () => number;
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Devices that have signed in successfully before (OWASP device-cookie pattern).
 *
 * Behind the public gateway every login arrives from loopback, so the address-wide
 * throttle bucket is shared by the owner and any remote caller. A device holding a
 * cookie issued here after a successful sign-in is throttled in its own bucket, so a
 * remote flood cannot lock the owner out. Only a hash of each random device id is kept,
 * in memory, so ids reset on restart together with the throttle itself.
 */
export class KnownDevices {
  private readonly devices = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxDevices: number;
  private readonly now: () => number;

  constructor(options: KnownDevicesOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEVICE_TTL_MS;
    this.maxDevices = options.maxDevices ?? MAX_DEVICES;
    this.now = options.now ?? Date.now;
  }

  get maxAgeSeconds() {
    return Math.floor(this.ttlMs / 1000);
  }

  issue(): string {
    const id = randomBytes(32).toString('base64url');
    this.devices.set(digest(id), this.now() + this.ttlMs);
    while (this.devices.size > this.maxDevices) {
      this.devices.delete(this.devices.keys().next().value!);
    }
    return id;
  }

  /** The throttle bucket for a recognised device, or undefined for an unknown one. */
  bucket(id: string | undefined): string | undefined {
    if (!id) return undefined;
    const key = digest(id);
    const expiresAt = this.devices.get(key);
    if (expiresAt === undefined) return undefined;
    if (expiresAt <= this.now()) {
      this.devices.delete(key);
      return undefined;
    }
    return `device:${key.slice(0, 16)}`;
  }
}
