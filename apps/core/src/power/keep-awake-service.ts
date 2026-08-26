import type { SettingsRepository } from '../../../../packages/store/src/settings.js';
import type { SleepInhibitor } from './platform-sleep-inhibitor.js';

export type KeepAwakeMode = 'off' | 'remote-connections' | 'managed-processes' | 'always';

export interface KeepAwakeStatus {
  mode: KeepAwakeMode;
  active: boolean;
  supported: boolean;
  platform: NodeJS.Platform;
  reason: string;
  remoteConnections: number;
  managedProcesses: number;
  message?: string;
}

type SettingsLike = Pick<SettingsRepository, 'get' | 'set'>;

interface KeepAwakeSignals {
  remoteConnectionCount(): number;
  managedProcessCount(): number;
}

interface KeepAwakeOptions {
  platform?: NodeJS.Platform;
  intervalMs?: number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

const MODES = new Set<KeepAwakeMode>(['off', 'remote-connections', 'managed-processes', 'always']);

export function isKeepAwakeMode(value: unknown): value is KeepAwakeMode {
  return MODES.has(value as KeepAwakeMode);
}

function normalizeMode(value: unknown): KeepAwakeMode {
  return isKeepAwakeMode(value) ? value : 'remote-connections';
}

export function countKeepAwakeRemoteConnections(rows: Array<{ status?: unknown }>): number {
  return rows.filter((row) => row.status === 'CONNECTED' || row.status === 'GRACE').length;
}

export function countKeepAwakeManagedProcesses(
  rows: Array<{ state?: unknown; ownership?: unknown }>,
): number {
  return rows.filter((row) => row.state === 'running' && row.ownership !== 'detached-uncertain')
    .length;
}

export class KeepAwakeService {
  private modeValue: KeepAwakeMode;
  private activeValue = false;
  private statusValue: KeepAwakeStatus;
  private timer?: ReturnType<typeof setInterval>;
  private readonly platform: NodeJS.Platform;
  private readonly intervalMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  constructor(
    private readonly settings: SettingsLike,
    private readonly inhibitor: SleepInhibitor,
    private readonly signals: KeepAwakeSignals,
    options: KeepAwakeOptions = {},
  ) {
    this.modeValue = normalizeMode(
      settings.get('power.keepAwake', { mode: 'remote-connections' }).mode,
    );
    this.platform = options.platform ?? process.platform;
    this.intervalMs = options.intervalMs ?? 5_000;
    this.setIntervalFn = options.setInterval ?? setInterval;
    this.clearIntervalFn = options.clearInterval ?? clearInterval;
    this.statusValue = this.buildStatus(0, 0, false);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.refresh();
    this.timer = this.setIntervalFn(() => void this.refresh(), this.intervalMs);
    this.timer.unref?.();
  }

  async close(): Promise<void> {
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = undefined;
    }
    await this.inhibitor.release();
    this.activeValue = false;
    const remoteConnections = this.safeCount(this.signals.remoteConnectionCount);
    const managedProcesses = this.safeCount(this.signals.managedProcessCount);
    this.statusValue = this.buildStatus(remoteConnections, managedProcesses, false);
  }

  async configure(mode: KeepAwakeMode): Promise<KeepAwakeStatus> {
    if (!MODES.has(mode)) throw new Error(`Invalid keep awake mode: ${String(mode)}`);
    this.modeValue = mode;
    this.settings.set('power.keepAwake', { mode });
    await this.refresh();
    return this.status();
  }

  async refresh(): Promise<KeepAwakeStatus> {
    const remoteConnections = this.safeCount(this.signals.remoteConnectionCount);
    const managedProcesses = this.safeCount(this.signals.managedProcessCount);
    const desired = this.shouldInhibit(remoteConnections, managedProcesses);

    if (desired) {
      if (!this.activeValue || !this.inhibitor.supported()) await this.inhibitor.acquire();
      this.activeValue = this.inhibitor.supported();
    } else {
      if (this.activeValue) await this.inhibitor.release();
      this.activeValue = false;
    }

    this.statusValue = this.buildStatus(remoteConnections, managedProcesses, desired);
    return this.status();
  }

  status(): KeepAwakeStatus {
    const next = { ...this.statusValue };
    next.supported = this.inhibitor.supported();
    next.active = next.active && next.supported;
    const message = this.inhibitor.message();
    if (message) next.message = message;
    else delete next.message;
    return next;
  }

  private safeCount(read: () => number): number {
    try {
      return Math.max(0, Math.floor(Number(read()) || 0));
    } catch {
      return 0;
    }
  }

  private shouldInhibit(remoteConnections: number, managedProcesses: number): boolean {
    if (this.modeValue === 'always') return true;
    if (this.modeValue === 'remote-connections') return remoteConnections > 0;
    if (this.modeValue === 'managed-processes') return managedProcesses > 0;
    return false;
  }

  private reason(remoteConnections: number, managedProcesses: number): string {
    if (this.modeValue === 'off') return 'Disabled';
    if (this.modeValue === 'always') return 'Aevra is running';
    if (this.modeValue === 'remote-connections' && remoteConnections > 0) {
      return `${remoteConnections} remote connection${remoteConnections === 1 ? '' : 's'}`;
    }
    if (this.modeValue === 'managed-processes' && managedProcesses > 0) {
      return `${managedProcesses} managed process${managedProcesses === 1 ? '' : 'es'}`;
    }
    return 'No matching activity';
  }

  private buildStatus(
    remoteConnections: number,
    managedProcesses: number,
    desired: boolean,
  ): KeepAwakeStatus {
    const supported = this.inhibitor.supported();
    return {
      mode: this.modeValue,
      active: desired && this.activeValue && supported,
      supported,
      platform: this.platform,
      reason: this.reason(remoteConnections, managedProcesses),
      remoteConnections,
      managedProcesses,
      ...(this.inhibitor.message() ? { message: this.inhibitor.message() } : {}),
    };
  }
}
