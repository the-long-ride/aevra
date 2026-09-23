import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExposureConfig } from '../../core/src/exposure/types.js';
import { runSetupCommand, type CloudflareSetupInput } from '../src/commands/setup-command.js';

interface CloudflareOptions {
  found?: boolean;
  version?: string;
  loginCode?: number;
  setupResult?: (input: CloudflareSetupInput) => Record<string, unknown>;
}

function harness(answers: string[], options: CloudflareOptions = {}) {
  const queue = [...answers];
  const prompts: string[] = [];
  const configs: ExposureConfig[] = [];
  const setups: CloudflareSetupInput[] = [];
  const errors: string[] = [];
  const state = { closed: 0, logins: 0 };
  const resources = {
    prompt: {
      async question(text: string) {
        prompts.push(text);
        return queue.shift() ?? '';
      },
    },
    configure(config: ExposureConfig) {
      configs.push(config);
    },
    cloudflare: {
      detectCloudflared: async () =>
        options.version === undefined
          ? { found: options.found ?? true }
          : { found: options.found ?? true, version: options.version },
      authenticate: async () => {
        state.logins += 1;
        return { code: options.loginCode ?? 0, stderr: 'login was cancelled' };
      },
      setup: async (input: CloudflareSetupInput) => {
        setups.push(input);
        return (options.setupResult?.(input) ?? { hostname: input.hostname }) as {
          hostname: string;
        };
      },
    },
    close() {
      state.closed += 1;
    },
  };
  const dependencies = {
    isInteractive: () => true,
    prepare: () => resources,
    needsAccess: (value: string) => value === 'access',
    error: (message: string) => errors.push(message),
    formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  };
  const run = () => runSetupCommand({}, { command: 'setup' }, dependencies);
  return { prompts, configs, setups, errors, state, run };
}

test('setup rejects an unsupported provider and still closes resources', async () => {
  const h = harness(['carrier-pigeon']);
  assert.equal(await h.run(), 1);
  assert.match(h.errors.at(-1)!, /setup failed: Unsupported exposure provider: carrier-pigeon/);
  assert.equal(h.state.closed, 1);
  assert.deepEqual(h.configs, []);
});

test('setup rejects a local protocol other than https or http', async () => {
  const h = harness(['local', 'gopher']);
  assert.equal(await h.run(), 1);
  assert.match(h.errors.at(-1)!, /Local gateway protocol must be https or http/);
  assert.equal(h.state.closed, 1);
});

test('setup accepts http for the loopback gateway and warns about it', async () => {
  const h = harness(['', ' HTTP ']);
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.configs, [{ provider: 'local', localProtocol: 'http' }]);
  assert.ok(h.errors.some((line) => /HTTP applies only to the loopback/.test(line)));
  assert.match(h.errors.at(-1)!, /Exposure configured: local/);
});

test('setup direct exposure forces https, skips the protocol prompt and defaults the host', async () => {
  const h = harness(['direct', ' https://aevra.example.com ', '']);
  assert.equal(await h.run(), 0);
  assert.equal(
    h.prompts.some((text) => text.startsWith('Local gateway protocol')),
    false,
  );
  assert.deepEqual(h.configs, [
    {
      provider: 'direct',
      localProtocol: 'https',
      publicUrl: 'https://aevra.example.com',
      direct: { host: '0.0.0.0' },
    },
  ]);
});

test('setup direct exposure keeps an explicit bind host', async () => {
  const h = harness(['direct', 'https://aevra.example.com', '127.0.0.1']);
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.configs[0], {
    provider: 'direct',
    localProtocol: 'https',
    publicUrl: 'https://aevra.example.com',
    direct: { host: '127.0.0.1' },
  });
});

test('setup external ngrok asks for and stores its public URL', async () => {
  const h = harness(['ngrok', 'http', ' EXTERNAL ', 'https://tunnel.example.com']);
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.configs, [
    {
      provider: 'ngrok',
      localProtocol: 'http',
      publicUrl: 'https://tunnel.example.com',
      ngrok: { ownership: 'external' },
    },
  ]);
});

test('setup external ngrok with an empty URL omits publicUrl', async () => {
  const h = harness(['ngrok', '', 'external', '']);
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.configs, [
    { provider: 'ngrok', localProtocol: 'https', ngrok: { ownership: 'external' } },
  ]);
});

test('setup Cloudflare fails when cloudflared is missing', async () => {
  const h = harness(['cloudflare', ''], { found: false });
  assert.equal(await h.run(), 1);
  assert.match(h.errors.at(-1)!, /cloudflared was not found on PATH/);
  assert.equal(h.state.logins, 0);
  assert.equal(h.state.closed, 1);
});

test('setup Cloudflare reports a failed login with its stderr', async () => {
  const h = harness(['cloudflare', '', ''], { loginCode: 2 });
  assert.equal(await h.run(), 1);
  assert.ok(h.errors.includes('[aevra] cloudflared: detected'));
  assert.match(h.errors.at(-1)!, /cloudflared login failed: login was cancelled/);
  assert.equal(h.state.logins, 1);
  assert.deepEqual(h.setups, []);
});

test('setup Cloudflare oauth logs in, creates a tunnel and keeps connector values empty', async () => {
  const h = harness(['cloudflare', '', 'yes', 'mcp.example.com', '', '', ''], {
    version: '2026.5.2',
    setupResult: (input) => ({ hostname: input.hostname }),
  });
  assert.equal(await h.run(), 0);
  assert.equal(h.state.logins, 1);
  assert.ok(h.errors.includes('[aevra] cloudflared: 2026.5.2'));
  assert.deepEqual(h.setups, [
    {
      hostname: 'mcp.example.com',
      tunnelId: undefined,
      authMode: 'connector',
      ownership: 'managed',
      issuer: undefined,
      audience: undefined,
    },
  ]);
  assert.deepEqual(h.configs, [
    {
      provider: 'cloudflare',
      localProtocol: 'https',
      publicUrl: 'https://mcp.example.com',
      cloudflare: {
        tunnelId: undefined,
        hostname: 'mcp.example.com',
        ownership: 'managed',
        authMode: 'oauth',
        issuer: undefined,
        audience: undefined,
      },
    },
  ]);
});

test('setup Cloudflare prefers values returned by the tunnel manager', async () => {
  const h = harness(['cloudflare', '', 'no', 'typed.example.com', 'typed-tunnel', '', ''], {
    setupResult: () => ({
      hostname: 'final.example.com',
      tunnelId: 'created-tunnel',
      ownership: 'external',
      authMode: 'access',
      issuer: 'https://team.example.com',
      audience: 'returned audience',
    }),
  });
  assert.equal(await h.run(), 0);
  assert.equal(h.state.logins, 0);
  assert.equal(h.setups[0]!.tunnelId, 'typed-tunnel');
  assert.deepEqual(h.configs[0], {
    provider: 'cloudflare',
    localProtocol: 'https',
    publicUrl: 'https://final.example.com',
    cloudflare: {
      tunnelId: 'created-tunnel',
      hostname: 'final.example.com',
      ownership: 'external',
      authMode: 'access',
      issuer: 'https://team.example.com',
      audience: 'returned audience',
    },
  });
});

test('setup Cloudflare Access falls back to typed values and omits empty ones', async () => {
  const h = harness(['cloudflare', '', 'n', 'mcp.example.com', '', 'access', '', 'aud words']);
  assert.equal(await h.run(), 0);
  assert.equal(h.setups[0]!.issuer, undefined);
  assert.equal(h.setups[0]!.audience, 'aud words');
  const cloudflare = (h.configs[0] as { cloudflare: Record<string, unknown> }).cloudflare;
  assert.equal(cloudflare.authMode, 'access');
  assert.equal(cloudflare.issuer, undefined);
  assert.equal(cloudflare.audience, 'aud words');
  assert.equal(cloudflare.ownership, 'managed');
});
