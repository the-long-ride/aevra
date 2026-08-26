import { spawn as spawnProcess } from 'node:child_process';

interface NgrokChild {
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'error' | 'exit', listener: (...args: any[]) => void): this;
}

interface NgrokTunnelResponse {
  tunnels?: Array<{ public_url?: unknown }>;
}

export interface NgrokDependencies {
  spawn(
    executable: string,
    args: string[],
    options: { shell: false; windowsHide: true; stdio: ['ignore', 'pipe', 'pipe'] },
  ): NgrokChild;
  fetchJson(): Promise<NgrokTunnelResponse>;
  sleep(ms: number): Promise<void>;
}

function isLoopbackHttps(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())
  );
}

const defaultDependencies: NgrokDependencies = {
  spawn(executable, args, options) {
    return spawnProcess(executable, args, options) as NgrokChild;
  },
  async fetchJson() {
    const response = await fetch('http://127.0.0.1:4040/api/tunnels', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`ngrok API returned HTTP ${response.status}`);
    return (await response.json()) as NgrokTunnelResponse;
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

export class NgrokAdapter {
  private child?: NgrokChild;
  private stateValue = 'stopped';
  private message?: string;
  private stopping = false;

  constructor(private readonly dependencies: NgrokDependencies = defaultDependencies) {}

  async start(
    localGatewayUrl: string,
    requestedPublicUrl?: string,
  ): Promise<{ publicUrl?: string }> {
    if (!isLoopbackHttps(localGatewayUrl)) {
      throw new Error('Managed ngrok requires a loopback HTTPS Aevra gateway origin');
    }
    await this.stop();
    this.stopping = false;
    this.stateValue = 'starting';
    this.message = undefined;

    const args = ['http', localGatewayUrl];
    if (requestedPublicUrl) args.push('--url', requestedPublicUrl);
    args.push('--log=stdout', '--log-format=json');
    const child = this.dependencies.spawn('ngrok', args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    let startupError: Error | undefined;
    child.once('error', (error: unknown) => {
      startupError = error instanceof Error ? error : new Error(String(error));
      this.stateValue = 'error';
      this.message = startupError.message;
    });
    child.once('exit', (code: number | null) => {
      if (this.stopping || this.child !== child) return;
      this.child = undefined;
      if (this.stateValue !== 'error') {
        this.stateValue = 'error';
        this.message = `ngrok exited before shutdown${code === null ? '' : ` with code ${code}`}`;
      }
    });

    let lastDiscoveryError: Error | undefined;
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        let value: NgrokTunnelResponse | undefined;
        try {
          value = await this.dependencies.fetchJson();
        } catch (error) {
          lastDiscoveryError = error instanceof Error ? error : new Error(String(error));
        }
        if (startupError) throw startupError;
        const publicUrl = value?.tunnels
          ?.map((tunnel) => tunnel.public_url)
          .find(
            (candidate): candidate is string =>
              typeof candidate === 'string' && candidate.startsWith('https://'),
          );
        if (publicUrl) {
          if (
            requestedPublicUrl &&
            new URL(publicUrl).origin !== new URL(requestedPublicUrl).origin
          ) {
            throw new Error(
              `ngrok stable URL mismatch: expected ${new URL(requestedPublicUrl).origin}, discovered ${new URL(publicUrl).origin}`,
            );
          }
          this.stateValue = 'ready';
          this.message = undefined;
          return { publicUrl };
        }
        if (attempt < 19) await this.dependencies.sleep(250);
      }
      throw (
        startupError ??
        lastDiscoveryError ??
        new Error('ngrok HTTPS forwarding URL was not discovered')
      );
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.stateValue = 'error';
      this.message = failure.message;
      if (this.child && !this.child.killed) this.child.kill('SIGTERM');
      this.child = undefined;
      throw failure;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.child && !this.child.killed) this.child.kill('SIGTERM');
    this.child = undefined;
    this.message = undefined;
    this.stateValue = 'stopped';
  }

  async status() {
    return {
      state: this.stateValue,
      ...(this.message ? { message: this.message } : {}),
    };
  }
}
