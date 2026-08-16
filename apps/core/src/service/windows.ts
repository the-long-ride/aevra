import type { ServiceIo, UserServiceAdapter } from './service-manager.js';
export class WindowsServiceAdapter implements UserServiceAdapter {
  readonly taskName = 'Aevra Gateway';
  constructor(
    private nodeExe: string,
    private cliPath: string,
    private io: ServiceIo,
  ) {}
  async install() {
    const tr = `\"${this.nodeExe}\" \"${this.cliPath}\" start`;
    const r = await this.io.run('schtasks.exe', [
      '/Create',
      '/TN',
      this.taskName,
      '/SC',
      'ONLOGON',
      '/TR',
      tr,
      '/F',
    ]);
    if (r.code) throw new Error(r.stderr || 'schtasks create failed');
  }
  async start() {
    const r = await this.io.run('schtasks.exe', ['/Run', '/TN', this.taskName]);
    if (r.code) throw new Error(r.stderr);
  }
  async stop() {
    await this.io.run('schtasks.exe', ['/End', '/TN', this.taskName]);
  }
  async restart() {
    await this.stop();
    await this.start();
  }
  async status() {
    const r = await this.io.run('schtasks.exe', ['/Query', '/TN', this.taskName, '/FO', 'LIST']);
    if (r.code) return 'not-installed';
    return /Running/i.test(r.stdout) ? 'running' : 'stopped';
  }
}
