import { spawn as spawnProcess } from 'node:child_process';

interface InhibitorChild {
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'error' | 'exit', listener: (...args: any[]) => void): this;
}

export interface AcquireOptions {
  /**
   * Also keep the display on. On Windows Modern Standby (S0 low power idle)
   * machines, turning the display off enters standby and drops the network even
   * while a system-required request is held, so this is the only way to stay
   * reachable there.
   */
  keepDisplayOn?: boolean;
}

export interface SleepInhibitor {
  acquire(options?: AcquireOptions): Promise<void>;
  release(): Promise<void>;
  supported(): boolean;
  message(): string | undefined;
}

export interface SleepInhibitorDependencies {
  spawn(
    executable: string,
    args: string[],
    options: { shell: false; windowsHide: true; stdio: 'ignore' },
  ): InhibitorChild;
  /** PID the helper watches so it exits with Aevra instead of outliving it. */
  parentPid?: number;
}

const defaultDependencies: SleepInhibitorDependencies = {
  spawn(executable, args, options) {
    return spawnProcess(executable, args, options) as InhibitorChild;
  },
};

function windowsEncodedCommand(parentPid: number, keepDisplayOn: boolean) {
  const flags = keepDisplayOn
    ? '$ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED'
    : '$ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED';
  const script = `$source = @'
using System;
using System.Runtime.InteropServices;
public static class AevraPower {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@
Add-Type -TypeDefinition $source
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]0x00000001
$ES_DISPLAY_REQUIRED = [uint32]0x00000002
$parentPid = ${parentPid}
try {
  while ($true) {
    if (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { break }
    $state = [AevraPower]::SetThreadExecutionState(${flags})
    if ($state -eq 0) { throw 'SetThreadExecutionState failed' }
    Start-Sleep -Seconds 5
  }
} finally {
  [void][AevraPower]::SetThreadExecutionState($ES_CONTINUOUS)
}`;
  return Buffer.from(script, 'utf16le').toString('base64');
}

function platformCommand(platform: NodeJS.Platform, parentPid: number, keepDisplayOn: boolean) {
  if (platform === 'win32') {
    return {
      executable: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        windowsEncodedCommand(parentPid, keepDisplayOn),
      ],
    };
  }
  if (platform === 'darwin') {
    // -i idle sleep, -s system sleep (on AC power), -d display; -w exits with Aevra.
    return {
      executable: 'caffeinate',
      args: ['-i', '-s', ...(keepDisplayOn ? ['-d'] : []), '-w', String(parentPid)],
    };
  }
  if (platform === 'linux') {
    // `tail --pid` ends when Aevra exits, which releases the logind inhibitor.
    return {
      executable: 'systemd-inhibit',
      args: [
        '--what=idle:sleep',
        '--mode=block',
        '--why=Aevra keep awake',
        'tail',
        `--pid=${parentPid}`,
        '-f',
        '/dev/null',
      ],
    };
  }
  return undefined;
}

function isSupportedPlatform(platform: NodeJS.Platform) {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux';
}

class ProcessSleepInhibitor implements SleepInhibitor {
  private child?: InhibitorChild;
  private childKeepsDisplayOn = false;
  private supportedValue: boolean;
  private messageValue?: string;
  private readonly parentPid: number;

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly dependencies: SleepInhibitorDependencies,
  ) {
    this.parentPid = dependencies.parentPid ?? process.pid;
    this.supportedValue = isSupportedPlatform(platform);
    if (!this.supportedValue) this.messageValue = `Keep awake is not supported on ${platform}`;
  }

  async acquire(options: AcquireOptions = {}): Promise<void> {
    const keepDisplayOn = options.keepDisplayOn === true;
    if (this.child && !this.child.killed) {
      if (this.childKeepsDisplayOn === keepDisplayOn) return;
      await this.release();
    }
    const command = platformCommand(this.platform, this.parentPid, keepDisplayOn);
    if (!command) {
      this.supportedValue = false;
      this.messageValue = `Keep awake is not supported on ${this.platform}`;
      return;
    }

    try {
      const child = this.dependencies.spawn(command.executable, command.args, {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      this.child = child;
      this.childKeepsDisplayOn = keepDisplayOn;
      this.supportedValue = true;
      this.messageValue = undefined;
      child.once('error', (error: unknown) => {
        if (this.child === child) this.child = undefined;
        this.supportedValue = false;
        this.messageValue = error instanceof Error ? error.message : String(error);
      });
      child.once('exit', (code: unknown) => {
        if (this.child !== child) return;
        this.child = undefined;
        this.supportedValue = false;
        this.messageValue = `Keep awake helper exited unexpectedly${typeof code === 'number' ? ` (code ${code})` : ''}`;
      });
    } catch (error) {
      this.child = undefined;
      this.supportedValue = false;
      this.messageValue = error instanceof Error ? error.message : String(error);
    }
  }

  async release(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) child.kill('SIGTERM');
  }

  supported(): boolean {
    return this.supportedValue;
  }

  message(): string | undefined {
    return this.messageValue;
  }
}

export function createPlatformSleepInhibitor(
  platform: NodeJS.Platform = process.platform,
  dependencies: SleepInhibitorDependencies = defaultDependencies,
): SleepInhibitor {
  return new ProcessSleepInhibitor(platform, dependencies);
}
