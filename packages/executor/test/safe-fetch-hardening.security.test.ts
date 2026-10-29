import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { safeFetch, type SafeFetchLookup } from '../src/safe-fetch.js';

const base = { maxBytes: 1_000_000, maxRedirects: 5, timeoutMs: 5000 } as const;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function table(map: Record<string, string[]>): SafeFetchLookup {
  return async (host) =>
    (map[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

test('a redirect response body is destroyed, not drained', async () => {
  let redirectClosed = false;
  let ticker: NodeJS.Timeout | undefined;
  const server = http.createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    if (req.url === '/a') {
      res.writeHead(302, { location: `http://second.test:${port}/b` });
      res.write('x'.repeat(1000));
      ticker = setInterval(() => res.write('x'.repeat(1000)), 10);
      res.on('close', () => {
        redirectClosed = true;
        clearInterval(ticker);
      });
      return;
    }
    res.end('landed');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const result = await safeFetch(`http://first.test:${port}/a`, {
      ...base,
      lookup: table({ 'first.test': ['93.184.216.34'], 'second.test': ['8.8.4.4'] }),
      dialOverride: () => '127.0.0.1',
    });
    assert.equal(result.status, 200);
    result.close();
    for (let i = 0; i < 40 && !redirectClosed; i++) await sleep(25);
    assert.equal(redirectClosed, true, 'the redirect body connection must be torn down');
  } finally {
    clearInterval(ticker);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a name lookup that never answers is covered by the fetch timeout', async () => {
  const never: SafeFetchLookup = () => new Promise(() => {});
  const outcome = await Promise.race([
    safeFetch('http://slow.test/', { ...base, timeoutMs: 100, lookup: never }).then(
      () => 'resolved',
      (error: any) => String(error.code),
    ),
    sleep(3000).then(() => 'hung'),
  ]);
  assert.equal(outcome, 'URL_TIMEOUT');
});
