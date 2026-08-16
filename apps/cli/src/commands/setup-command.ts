import type { AevraCommand } from '../args.js';
import type { ExposureConfig } from '../../../core/src/exposure/types.js';

type SetupCommand = Extract<AevraCommand, { command: 'setup' }>;
type Ownership = 'managed' | 'external';

type CloudflareAuthMode = 'connector' | 'access';

interface CloudflareSetupInput {
  hostname: string;
  tunnelId?: string;
  authMode: CloudflareAuthMode;
  ownership: Ownership;
  issuer?: string;
  audience?: string;
}

interface CloudflareSetupManager {
  detectCloudflared(): Promise<{ found: boolean; version?: string }>;
  authenticate(): Promise<{ code: number; stderr: string }>;
  setup(input: CloudflareSetupInput): Promise<{
    hostname: string;
    tunnelId?: string;
    ownership?: Ownership;
    authMode?: CloudflareAuthMode;
    issuer?: string;
    audience?: string;
  }>;
}

interface Prompt {
  question(text: string): Promise<string>;
}

export interface SetupResources {
  prompt: Prompt;
  cloudflare: CloudflareSetupManager;
  configure(config: ExposureConfig): void | Promise<void>;
  close(): void;
}

export interface SetupCommandDependencies<Config> {
  isInteractive(): boolean;
  prepare(config: Config): SetupResources;
  needsAccess(value: string): boolean;
  error(message: string): void;
  formatError(error: unknown): string;
}

async function configureSimpleProvider(
  provider: 'local' | 'direct' | 'ngrok' | 'external',
  resources: SetupResources,
): Promise<void> {
  const { prompt } = resources;
  if (provider === 'local') {
    await resources.configure({ provider: 'local' });
    return;
  }
  if (provider === 'direct') {
    const publicUrl = (await prompt.question('Public HTTPS URL: ')).trim();
    const host = (await prompt.question('Direct bind host (0.0.0.0): ')).trim() || '0.0.0.0';
    await resources.configure({ provider: 'direct', publicUrl, direct: { host } });
    return;
  }
  if (provider === 'external') {
    const publicUrl = (await prompt.question('Public HTTPS URL: ')).trim();
    await resources.configure({ provider: 'external', publicUrl });
    return;
  }

  const ownership: Ownership =
    (await prompt.question('ngrok ownership [managed/external] (managed): '))
      .trim()
      .toLowerCase() === 'external'
      ? 'external'
      : 'managed';
  const publicUrl =
    ownership === 'external' ? (await prompt.question('Public HTTPS URL: ')).trim() : undefined;
  await resources.configure({
    provider: 'ngrok',
    ...(publicUrl ? { publicUrl } : {}),
    ngrok: { ownership },
  });
}

async function configureCloudflare<Config>(
  resources: SetupResources,
  dependencies: SetupCommandDependencies<Config>,
): Promise<void> {
  const { prompt, cloudflare } = resources;
  const detected = await cloudflare.detectCloudflared();
  if (!detected.found) throw new Error('cloudflared was not found on PATH');

  dependencies.error(`[aevra] cloudflared: ${detected.version ?? 'detected'}`);
  const login = (await prompt.question('Authenticate/select Cloudflare account now? [Y/n] '))
    .trim()
    .toLowerCase();
  if (login !== 'n' && login !== 'no') {
    const result = await cloudflare.authenticate();
    if (result.code !== 0) throw new Error(`cloudflared login failed: ${result.stderr}`);
  }

  const hostname = (
    await prompt.question('Public Aevra hostname (for example aevra.example.com): ')
  ).trim();
  const tunnelId = (
    await prompt.question('Existing tunnel ID (leave empty to create Aevra tunnel): ')
  ).trim();
  const authAnswer = (
    await prompt.question('Cloudflare outer authentication [oauth/access] (oauth): ')
  )
    .trim()
    .toLowerCase();
  const access = dependencies.needsAccess(authAnswer);

  let issuer = '';
  let audience = '';
  if (access) {
    issuer = (await prompt.question('Cloudflare Access issuer URL: ')).trim();
    audience = (await prompt.question('Cloudflare Access audience: ')).trim();
  }

  const ownership: Ownership =
    (await prompt.question('Tunnel ownership [managed/external] (managed): '))
      .trim()
      .toLowerCase() === 'external'
      ? 'external'
      : 'managed';
  const result = await cloudflare.setup({
    hostname,
    tunnelId: tunnelId || undefined,
    authMode: access ? 'access' : 'connector',
    ownership,
    issuer: issuer || undefined,
    audience: audience || undefined,
  });

  const finalOwnership = result.ownership ?? ownership;
  const finalAccess = result.authMode === 'access' || access;
  await resources.configure({
    provider: 'cloudflare',
    publicUrl: `https://${result.hostname}`,
    cloudflare: {
      tunnelId: result.tunnelId ?? (tunnelId || undefined),
      hostname: result.hostname,
      ownership: finalOwnership,
      authMode: finalAccess ? 'access' : 'oauth',
      issuer: finalAccess ? (result.issuer ?? (issuer || undefined)) : undefined,
      audience: finalAccess ? (result.audience ?? (audience || undefined)) : undefined,
    },
  });
}

export async function runSetupCommand<Config>(
  config: Config,
  _command: SetupCommand,
  dependencies: SetupCommandDependencies<Config>,
): Promise<number> {
  if (!dependencies.isInteractive()) {
    dependencies.error(
      '[aevra] setup requires an interactive terminal; alternatively use Aevra UI → Settings → Remote Access.',
    );
    return 1;
  }

  const resources = dependencies.prepare(config);
  try {
    const answer = (
      await resources.prompt.question(
        'Exposure provider [local/direct/cloudflare/ngrok/external] (local): ',
      )
    )
      .trim()
      .toLowerCase();
    const provider = answer || 'local';
    if (!['local', 'direct', 'cloudflare', 'ngrok', 'external'].includes(provider)) {
      throw new Error(`Unsupported exposure provider: ${provider}`);
    }

    if (provider === 'cloudflare') {
      await configureCloudflare(resources, dependencies);
    } else {
      await configureSimpleProvider(
        provider as 'local' | 'direct' | 'ngrok' | 'external',
        resources,
      );
    }
    dependencies.error(`[aevra] Exposure configured: ${provider}.`);
    return 0;
  } catch (error) {
    dependencies.error(`[aevra] setup failed: ${dependencies.formatError(error)}`);
    return 1;
  } finally {
    resources.close();
  }
}
