import { spawn } from 'node:child_process';
import type { SecretStore } from './store.js';

export interface ProcessAdapter {
  run(file: string, args: string[], input?: string): Promise<{ code: number; stdout: string }>;
}

export class SpawnAdapter implements ProcessAdapter {
  async run(
    file: string,
    args: string[],
    input?: string,
  ): Promise<{ code: number; stdout: string }> {
    return await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
      const child = spawn(file, args, {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.once('error', reject);
      child.once('exit', (code: number | null) => resolve({ code: code ?? 1, stdout }));
      if (input) child.stdin.end(input);
      else child.stdin.end();
    });
  }
}

export class CommandSecretStore implements SecretStore {
  constructor(
    private platform: NodeJS.Platform,
    private adapter: ProcessAdapter = new SpawnAdapter(),
    private service = 'Aevra',
  ) {}

  async probe() {
    try {
      const result =
        this.platform === 'darwin'
          ? await this.adapter.run('security', ['help'])
          : this.platform === 'linux'
            ? await this.adapter.run('secret-tool', ['--help'])
            : this.platform === 'win32'
              ? await this.adapter.run('powershell.exe', [
                  '-NoProfile',
                  '-Command',
                  '$PSVersionTable.PSVersion.Major',
                ])
              : { code: 1, stdout: '' };
      return result.code === 0;
    } catch {
      return false;
    }
  }

  async set(ref: string, value: string) {
    if (this.platform === 'darwin') {
      const result = await this.adapter.run('security', [
        'add-generic-password',
        '-U',
        '-a',
        ref,
        '-s',
        this.service,
        '-w',
        value,
      ]);
      if (result.code) throw new Error('Keychain store failed');
      return;
    }
    if (this.platform === 'linux') {
      const result = await this.adapter.run(
        'secret-tool',
        ['store', `--label=${this.service}`, 'service', this.service, 'ref', ref],
        value,
      );
      if (result.code) throw new Error('Secret Service store failed');
      return;
    }
    if (this.platform === 'win32') {
      const script = `$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value).toString('base64')}'));cmdkey /generic:${this.service}:${ref} /user:${this.service} /pass:$v | Out-Null`;
      const result = await this.adapter.run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ]);
      if (result.code) throw new Error('Credential Manager store failed');
      return;
    }
    throw new Error('unsupported platform');
  }

  async get(ref: string) {
    if (this.platform === 'darwin') {
      const result = await this.adapter.run('security', [
        'find-generic-password',
        '-a',
        ref,
        '-s',
        this.service,
        '-w',
      ]);
      return result.code === 0 ? result.stdout.trim() : null;
    }
    if (this.platform === 'linux') {
      const result = await this.adapter.run('secret-tool', [
        'lookup',
        'service',
        this.service,
        'ref',
        ref,
      ]);
      return result.code === 0 ? result.stdout.trim() : null;
    }
    return null;
  }

  async delete(ref: string) {
    if (this.platform === 'darwin') {
      await this.adapter.run('security', [
        'delete-generic-password',
        '-a',
        ref,
        '-s',
        this.service,
      ]);
    } else if (this.platform === 'linux') {
      await this.adapter.run('secret-tool', ['clear', 'service', this.service, 'ref', ref]);
    } else if (this.platform === 'win32') {
      await this.adapter.run('cmdkey', [`/delete:\`${this.service}:${ref}\``]);
    }
  }
}
