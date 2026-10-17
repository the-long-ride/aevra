import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { PublicGateway } from '../src/gateway/public-gateway.js';

test('gateway rejects normalized authority paths and unexpected ingress hosts', async () => {
  const paths: string[] = [];
  const sink = http.createServer((req, res) => {
    paths.push(req.url!);
    res.end('origin');
  });
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve));
  const address = sink.address() as { port: number };
  const gateway = new PublicGateway({
    host: '127.0.0.1',
    port: 0,
    protocol: 'http',
    targets: {
      adminUrl: `http://127.0.0.1:${address.port}`,
      mcpUrl: `http://127.0.0.1:${address.port}`,
    },
    gatewayTrustSecret: 'ordinary gateway trust words',
    allowedOrigins: () => ['https://public.example.test'],
  });
  await gateway.start();
  const request = (path: string, host = new URL(gateway.url()).host) =>
    new Promise<number>((resolve, reject) => {
      const req = http.request(gateway.url(), { path, headers: { host } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
      });
      req.on('error', reject);
      req.end();
    });
  try {
    for (const prefix of ['/safe/..//', '/safe/%2e%2e//'])
      assert.equal(await request(`${prefix}127.0.0.1:${address.port}/captured`), 400);
    assert.equal(paths.length, 0);
    assert.equal(await request('/api/health', 'attacker.example.test'), 421);
    assert.equal(await request('/health', 'public.example.test'), 200);
    assert.equal(await request('/api/health'), 200);
    assert.deepEqual(paths, ['/health', '/api/health']);
  } finally {
    await gateway.close();
    await new Promise<void>((resolve) => sink.close(() => resolve()));
  }
});
