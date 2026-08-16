import path from 'node:path';
import type { ServiceIo, UserServiceAdapter } from './service-manager.js';
export class LinuxServiceAdapter implements UserServiceAdapter {
  readonly unit = 'aevra-gateway.service';
  constructor(
    private nodeExe: string,
    private cliPath: string,
    private io: ServiceIo,
  ) {}
  get file() {
    return path.join(this.io.home, '.config', 'systemd', 'user', this.unit);
  }
  async install() {
    const content = `[Unit]\nDescription=Aevra MCP Execution Gateway\nAfter=network-online.target\n\n[Service]\nType=simple\nExecStart=${quote(this.nodeExe)} ${quote(this.cliPath)} start\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n`;
    await this.io.write(this.file, content);
    await this.io.run('systemctl', ['--user', 'daemon-reload']);
    const r = await this.io.run('systemctl', ['--user', 'enable', this.unit]);
    if (r.code) throw new Error(r.stderr);
  }
  async start() {
    const r = await this.io.run('systemctl', ['--user', 'start', this.unit]);
    if (r.code) throw new Error(r.stderr);
  }
  async stop() {
    await this.io.run('systemctl', ['--user', 'stop', this.unit]);
  }
  async restart() {
    const r = await this.io.run('systemctl', ['--user', 'restart', this.unit]);
    if (r.code) throw new Error(r.stderr);
  }
  async status() {
    const r = await this.io.run('systemctl', ['--user', 'is-active', this.unit]);
    if (r.code && /not-found|could not be found/i.test(r.stderr)) return 'not-installed';
    return r.stdout.trim() === 'active' ? 'running' : r.code === 0 ? 'running' : 'stopped';
  }
}
function quote(s: string) {
  return s.replaceAll('\\', '\\x5c').replaceAll(' ', '\\x20');
}
