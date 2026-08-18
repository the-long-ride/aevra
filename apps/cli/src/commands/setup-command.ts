import type { AevraCommand } from '../args.js';

type SetupCommand = Extract<AevraCommand, { command: 'setup' }>;

type Ownership = 'managed' | 'external';
type AuthMode = 'connector' | 'access';

interface SetupInput {
  hostname: string;
  tunnelId?: string;
  authMode: AuthMode;
  ownership: Ownership;
  issuer?: string;
  audience?: string;
}

interface SetupManager {
  detectCloudflared(): Promise<{ found: boolean; version?: string }>;
  authenticate(): Promise<{ code: number; stderr: string }>;
  setup(input: SetupInput): Promise<{ hostname: string }>;
}

interface Prompt {
  question(text: string): Promise<string>;
}

export interface SetupResources {
  prompt: Prompt;
  manager: SetupManager;
  close(): void;
}

export interface SetupCommandDependencies<Config> {
  isInteractive(): boolean;
  prepare(config: Config): SetupResources;
  needsAccess(value: string): boolean;
  error(message: string): void;
  formatError(error: unknown): string;
}

export async function runSetupCommand<Config>(
  config: Config,
  _command: SetupCommand,
  dependencies: SetupCommandDependencies<Config>,
): Promise<number> {
  if (!dependencies.isInteractive()) {
    dependencies.error(
      '[aevra] setup requires an interactive terminal; alternatively use Aevra UI → Settings → Cloudflare.',
    );
    return 1;
  }

  const resources = dependencies.prepare(config);
  const { prompt, manager } = resources;

  try {
    const detected = await manager.detectCloudflared();
    if (!detected.found) {
      dependencies.error('[aevra] cloudflared was not found on PATH.');
      return 1;
    }

    dependencies.error(`[aevra] cloudflared: ${detected.version ?? 'detected'}`);
    const login = (
      await prompt.question('Authenticate/select Cloudflare account now? [Y/n] ')
    )
      .trim()
      .toLowerCase();
    if (login !== 'n' && login !== 'no') {
      const result = await manager.authenticate();
      if (result.code !== 0) {
        throw new Error(`cloudflared login failed: ${result.stderr}`);
      }
    }

    const hostname = (
      await prompt.question('Public MCP hostname (for example mcp.example.com): ')
    ).trim();
    const tunnelId = (
      await prompt.question('Existing tunnel ID (leave empty to create Aevra tunnel): ')
    ).trim();
    const authAnswer = (
      await prompt.question('Remote MCP authentication [connector/access] (connector): ')
    )
      .trim()
      .toLowerCase();
    const authMode: AuthMode = dependencies.needsAccess(authAnswer)
      ? 'access'
      : 'connector';

    let issuer = '';
    let audience = '';
    if (authMode === 'access') {
      dependencies.error(
        '[aevra] Create/select a Cloudflare Access application for /mcp, then enter its verifier values.',
      );
      issuer = (await prompt.question('Cloudflare Access issuer URL: ')).trim();
      audience = (await prompt.question('Cloudflare Access audience: ')).trim();
    } else {
      dependencies.error(
        '[aevra] Connector-token mode selected: plain /mcp stays closed; use /mcp/<token> URLs created by aevra connectors create.',
      );
    }

    const ownership: Ownership =
      (
        await prompt.question('Tunnel ownership [managed/external] (managed): ')
      )
        .trim()
        .toLowerCase() === 'external'
        ? 'external'
        : 'managed';

    const result = await manager.setup({
      hostname,
      tunnelId: tunnelId || undefined,
      authMode,
      ownership,
      issuer: issuer || undefined,
      audience: audience || undefined,
    });
    dependencies.error(
      `[aevra] Configured https://${result.hostname}/mcp (${ownership} tunnel ownership, ${authMode} authentication).`,
    );
    if (authMode === 'connector') {
      dependencies.error('[aevra] Next: aevra connectors create ChatGPT');
    }
    return 0;
  } catch (error) {
    dependencies.error(`[aevra] setup failed: ${dependencies.formatError(error)}`);
    return 1;
  } finally {
    resources.close();
  }
}
