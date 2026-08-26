import { spawn as spawnProcess } from 'node:child_process';

interface InhibitorChild {
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'error' | 'exit', listener: (...args: any[]) => void): this;
}

export interface SleepInhibitor {
  acquire(): Promise<void>;
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
}

const defaultDependencies: SleepInhibitorDependencies = {
  spawn(executable, args, options) {
    return spawnProcess(executable, args, options) as InhibitorChild;
  },
};

function windowsEncodedCommand() {
  const script = `$source = @'
using System;
using System.Runtime.InteropServices;
public static class AevraPower {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@
Add-Type -TypeDefinition $source
$ES_CONTINUOUS = [uint32]0x80000000
$ES_SYSTEM_REQUIRED = [uint32]0x00000001
[void][AevraPower]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)
try {
  while ($true) { Start-Sleep -Seconds 3600 }
} finally {
  [void][AevraPower]::SetThreadExecutionState($ES_CONTINUOUS)
}`;
  return Buffer.from(script, 'utf16le').toString('base64');
}

function platformCommand(platform: NodeJS.Platform) {
  if (platform === 'win32') {
    return {
      executable: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', windowsEncodedCommand()],
    };
  }
  if (platform === 'darwin') return { executable: 'caffeinate', args: ['-i'] };
  if (platform === 'linux') {
    return {
      executable: 'systemd-inhibit',
      args: ['--what=idle', '--mode=block', '--why=Aevra keep awake', 'sleep', 'infinity'],
    };
  }
  return undefined;
}

class ProcessSleepInhibitor implements SleepInhibitor {
  private child?: InhibitorChild;
  private supportedValue: boolean;
  private messageValue?: string;

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly dependencies: SleepInhibitorDependencies,
  ) {
    this.supportedValue = platformCommand(platform) !== undefined;
    if (!this.supportedValue) this.messageValue = `Keep awake is not supported on ${platform}`;
  }

  async acquire(): Promise<void> {
    if (this.child && !this.child.killed) return;
    const command = platformCommand(this.platform);
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
