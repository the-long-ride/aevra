import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WindowsServiceAdapter } from './windows.js';
import { LinuxServiceAdapter } from './linux.js';
import { MacosServiceAdapter } from './macos.js';
export interface UserServiceAdapter {
  install(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<'running' | 'stopped' | 'not-installed' | 'unknown'>;
}
export interface ServiceIo {
  run(file: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  write(file: string, content: string): Promise<void>;
  remove(file: string): Promise<void>;
  home: string;
  uid?: number;
}
export function defaultServiceIo(): ServiceIo {
  return {
    home: os.homedir(),
    uid: process.getuid?.(),
    async run(file, args) {
      return new Promise((resolve, reject) => {
        const c = spawn(file, args, { shell: false, windowsHide: true });
        let stdout = '',
          stderr = '';
        c.stdout?.on('data', (b) => (stdout += b));
        c.stderr?.on('data', (b) => (stderr += b));
        c.once('error', reject);
        c.once('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
      });
    },
    async write(file, content) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, { mode: 0o600 });
    },
    async remove(file) {
      await rm(file, { force: true });
    },
  };
}
export function createUserServiceAdapter(
  platform: NodeJS.Platform,
  nodeExe: string,
  cliPath: string,
  io: ServiceIo = defaultServiceIo(),
): UserServiceAdapter {
  if (platform === 'win32') return new WindowsServiceAdapter(nodeExe, cliPath, io);
  if (platform === 'linux') return new LinuxServiceAdapter(nodeExe, cliPath, io);
  if (platform === 'darwin') return new MacosServiceAdapter(nodeExe, cliPath, io);
  throw new Error(`Unsupported platform: ${platform}`);
}
