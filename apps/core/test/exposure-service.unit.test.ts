import assert from 'node:assert/strict';
import test from 'node:test';
import { ExposureService } from '../src/exposure/service.js';
import type { ExposureAdapter } from '../src/exposure/types.js';

function fakeAdapter(options: { publicUrl?: string; fail?: Error } = {}) {
  const calls: string[] = [];
  const value: ExposureAdapter = {
    async start(localGatewayUrl, requestedPublicUrl) {
      calls.push('start:' + localGatewayUrl + (requestedPublicUrl ? ':' + requestedPublicUrl : ''));
      if (options.fail) throw options.fail;
      return { publicUrl: options.publicUrl };
    },
    async stop() {
      calls.push('stop');
    },
    async status() {
      return { state: 'ready' };
    },
  };
  return { value, calls };
}

test('local direct and external exposure publish their intended URL without starting a managed provider', async () => {
  const cloudflare = fakeAdapter();
  const ngrok = fakeAdapter();
  const service = new ExposureService({ cloudflare: cloudflare.value, ngrok: ngrok.value });

  let status = await service.start({ provider: 'local' }, 'https://localhost:47830');
  assert.equal(status.publicUrl, 'https://localhost:47830');

  status = await service.start(
    { provider: 'direct', publicUrl: 'https://aevra.example.com', direct: { host: '0.0.0.0' } },
    'https://localhost:47830',
  );
  assert.equal(status.publicUrl, 'https://aevra.example.com');

  status = await service.start(
    { provider: 'external', publicUrl: 'https://proxy.example.com' },
    'https://localhost:47830',
  );
  assert.equal(status.publicUrl, 'https://proxy.example.com');
  assert.deepEqual(cloudflare.calls, []);
  assert.deepEqual(ngrok.calls, []);
});

test('managed provider failure never falls back to the local gateway URL', async () => {
  const ngrok = fakeAdapter({ fail: new Error('provider unavailable') });
  const service = new ExposureService({ ngrok: ngrok.value });

  await assert.rejects(
    () =>
      service.start(
        { provider: 'ngrok', ngrok: { ownership: 'managed' } },
        'https://localhost:47830',
      ),
    /provider unavailable/,
  );
  assert.equal(service.status().state, 'error');
  assert.equal(service.status().publicUrl, undefined);
  assert.throws(() => service.effectivePublicUrl(), /unavailable/i);
});

test('closing exposure stops the active managed provider', async () => {
  const cloudflare = fakeAdapter({ publicUrl: 'https://mcp.example.com' });
  const service = new ExposureService({ cloudflare: cloudflare.value });

  await service.start(
    {
      provider: 'cloudflare',
      publicUrl: 'https://mcp.example.com',
      cloudflare: { ownership: 'managed', authMode: 'oauth', hostname: 'mcp.example.com' },
    },
    'https://localhost:47830',
  );
  await service.close();
  assert.deepEqual(cloudflare.calls, ['start:https://localhost:47830', 'stop']);
  assert.equal(service.status().state, 'stopped');
});

test('managed stable ngrok passes its configured public URL to the adapter', async () => {
  const ngrok = fakeAdapter({ publicUrl: 'https://stable.example.ngrok.app' });
  const service = new ExposureService({ ngrok: ngrok.value });
  const status = await service.start(
    {
      provider: 'ngrok',
      publicUrl: 'https://stable.example.ngrok.app',
      ngrok: { ownership: 'managed', domainMode: 'stable' },
    },
    'https://localhost:47830',
  );
  assert.equal(status.publicUrl, 'https://stable.example.ngrok.app');
  assert.deepEqual(ngrok.calls, ['start:https://localhost:47830:https://stable.example.ngrok.app']);
});
