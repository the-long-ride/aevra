import { spawn, type ChildProcess } from 'node:child_process';

type CommandRunResult = { code: number; stdout: string; stderr: string };

export interface CommandRunner {
  run(file: string, args: string[]): Promise<CommandRunResult>;
  spawn(file: string, args: string[]): ChildProcess;
}
export class SpawnCommandRunner implements CommandRunner {
  async run(file: string, args: string[]): Promise<CommandRunResult> {
    return await new Promise<CommandRunResult>((resolve, reject) => {
      const c = spawn(file, args, { shell: false, windowsHide: true });
      let stdout = '',
        stderr = '';
      c.stdout?.on('data', (b) => (stdout += b));
      c.stderr?.on('data', (b) => (stderr += b));
      c.once('error', reject);
      c.once('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  }
  spawn(file: string, args: string[]) {
    return spawn(file, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}
export class CloudflaredCli {
  constructor(
    private runner: CommandRunner = new SpawnCommandRunner(),
    readonly executable = 'cloudflared',
  ) {}
  async version() {
    try {
      const r = await this.runner.run(this.executable, ['version']);
      return r.code === 0
        ? { found: true, version: r.stdout.trim() || r.stderr.trim(), path: this.executable }
        : { found: false };
    } catch {
      return { found: false };
    }
  }
  async login() {
    return this.runner.run(this.executable, ['tunnel', 'login']);
  }
  async listTunnels() {
    return this.runner.run(this.executable, ['tunnel', 'list']);
  }
  async createTunnel(name = 'aevra') {
    return this.runner.run(this.executable, ['tunnel', 'create', name]);
  }
  async routeDns(tunnelId: string, hostname: string) {
    return this.runner.run(this.executable, ['tunnel', 'route', 'dns', tunnelId, hostname]);
  }
  spawnTunnel(tunnelId: string, origin: string) {
    const args = ['tunnel', '--no-autoupdate', 'run', '--url', origin];
    if (/^https:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(origin))
      args.push('--no-tls-verify');
    args.push(tunnelId);
    return this.runner.spawn(this.executable, args);
  }
}
