import type { BrowserOriginClass } from '../../../../packages/protocol/src/browser.js';

const SETTINGS_KEY = 'browser.originPolicy';
const CLASSES: BrowserOriginClass[] = ['BLOCKED', 'SENSITIVE', 'NORMAL'];

export interface StoredOriginPolicy {
  loopbackClass: BrowserOriginClass;
  blockedHosts: string[];
  sensitiveHosts: string[];
}

export interface OriginPolicySnapshot extends StoredOriginPolicy {
  aevraPorts: number[];
  aevraOrigins: string[];
}

export interface AevraPorts {
  publicPort: number;
  adminPort: number;
  mcpPort: number;
  browserPort: number;
}

interface SettingsLike {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

const DEFAULTS: StoredOriginPolicy = {
  loopbackClass: 'SENSITIVE',
  blockedHosts: [],
  sensitiveHosts: [],
};

function hosts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

/**
 * Operator-editable origin policy, merged with the ports Aevra is actually
 * listening on and the off-loopback origins it is actually reachable at.
 *
 * Neither is stored. A settings row that outlived a port change, a tunnel
 * being enabled, or a public URL being edited would be an allowance nobody
 * remembers granting, so both are read from live config on every snapshot
 * instead.
 */
export class BrowserOriginPolicyService {
  constructor(
    private readonly settings: SettingsLike,
    private readonly ports: () => AevraPorts,
    /**
     * Every URL or origin that currently serves Aevra's own surface off
     * loopback - the gateway's advertised URL, a managed tunnel hostname, the
     * trusted admin origins. Unparseable or empty entries are dropped here so
     * the policy never has to defend against them.
     */
    private readonly origins: () => Array<string | undefined> = () => [],
  ) {}

  stored(): StoredOriginPolicy {
    const raw = this.settings.get<Partial<StoredOriginPolicy>>(SETTINGS_KEY, DEFAULTS);
    const loopbackClass = raw?.loopbackClass;
    return {
      loopbackClass: CLASSES.includes(loopbackClass as BrowserOriginClass)
        ? (loopbackClass as BrowserOriginClass)
        : DEFAULTS.loopbackClass,
      blockedHosts: hosts(raw?.blockedHosts),
      sensitiveHosts: hosts(raw?.sensitiveHosts),
    };
  }

  private aevraOrigins(): string[] {
    const seen = new Set<string>();
    let entries: Array<string | undefined>;
    try {
      entries = this.origins() ?? [];
    } catch {
      // A resolver that reads exposure state can throw while the runtime is
      // still assembling. An empty list is the wrong answer to fail toward, so
      // it is reported as empty rather than swallowed silently - the port rule
      // still applies, and the loopback surface stays blocked either way.
      entries = [];
    }
    for (const entry of entries) {
      const value = String(entry ?? '').trim();
      if (value) seen.add(value.toLowerCase());
    }
    return [...seen];
  }

  snapshot(): OriginPolicySnapshot {
    const { publicPort, adminPort, mcpPort, browserPort } = this.ports();
    return {
      ...this.stored(),
      aevraPorts: [publicPort, adminPort, mcpPort, browserPort],
      aevraOrigins: this.aevraOrigins(),
    };
  }

  update(next: Partial<StoredOriginPolicy>): StoredOriginPolicy {
    if (
      next.loopbackClass !== undefined &&
      !CLASSES.includes(next.loopbackClass as BrowserOriginClass)
    ) {
      throw Object.assign(new Error('loopbackClass must be BLOCKED, SENSITIVE or NORMAL'), {
        code: 'ORIGIN_POLICY_INVALID',
        status: 400,
      });
    }
    const merged: StoredOriginPolicy = {
      ...this.stored(),
      ...(next.loopbackClass === undefined ? {} : { loopbackClass: next.loopbackClass }),
      ...(next.blockedHosts === undefined ? {} : { blockedHosts: hosts(next.blockedHosts) }),
      ...(next.sensitiveHosts === undefined ? {} : { sensitiveHosts: hosts(next.sensitiveHosts) }),
    };
    this.settings.set(SETTINGS_KEY, merged);
    return merged;
  }
}
