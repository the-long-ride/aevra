import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { isPublicAddress, safeFetch, type SafeFetchLookup } from '../src/safe-fetch.js';

test('isPublicAddress classifies address families', () => {
  const blocked = [
    '127.0.0.1',
    '127.8.9.10',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '169.254.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '0.1.2.3',
    '224.0.0.1',
    '239.255.255.255',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe',
    'not-an-address',
    '',
  ];
  for (const ip of blocked) assert.equal(isPublicAddress(ip), false, ip);
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111'];
  for (const ip of allowed) assert.equal(isPublicAddress(ip), true, ip);
  assert.equal(isPublicAddress('::ffff:8.8.8.8'), true);
});

interface Seen {
  host: string | undefined;
  headers: http.IncomingHttpHeaders;
  url: string | undefined;
}

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, port: number) => void,
  run: (port: number, seen: Seen[]) => Promise<void>,
) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, headers: req.headers, url: req.url });
    handler(req, res, (server.address() as AddressInfo).port);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run((server.address() as AddressInfo).port, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function drain(body: AsyncIterable<Uint8Array>) {
  const parts: Buffer[] = [];
  for await (const chunk of body) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

const base = { maxBytes: 1_000_000, maxRedirects: 5, timeoutMs: 5000 } as const;

function stubLookup(table: Record<string, string[]>, calls: string[] = []): SafeFetchLookup {
  return async (host) => {
    calls.push(host);
    const list = table[host];
    if (!list) throw Object.assign(new Error('no such host'), { code: 'ENOTFOUND' });
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}

test('a literal loopback address is refused before any connection', async () => {
  await withServer(
    (_req, res) => res.end('hidden'),
    async (port, seen) => {
      await assert.rejects(
        () => safeFetch(`http://127.0.0.1:${port}/`, base),
        (e: any) => e.code === 'URL_NOT_PUBLIC',
      );
      assert.equal(seen.length, 0);
    },
  );
});

test('a name resolving to a private address is refused, even if only one answer is private', async () => {
  await assert.rejects(
    () =>
      safeFetch('http://mixed.test/', {
        ...base,
        lookup: stubLookup({ 'mixed.test': ['8.8.8.8', '10.0.0.5'] }),
      }),
    (e: any) => e.code === 'URL_NOT_PUBLIC',
  );
  await assert.rejects(
    () => safeFetch('http://[::1]/', base),
    (e: any) => e.code === 'URL_NOT_PUBLIC',
  );
  await assert.rejects(
    () => safeFetch('http://169.254.169.254/latest/meta-data', base),
    (e: any) => e.code === 'URL_NOT_PUBLIC',
  );
});

test('only http and https without userinfo are accepted', async () => {
  for (const url of [
    'file:///etc/hosts',
    'ftp://example.test/x',
    'http://user:word@example.test/',
    'data:text/plain,hello',
  ]) {
    await assert.rejects(
      () => safeFetch(url, { ...base, lookup: stubLookup({ 'example.test': ['8.8.8.8'] }) }),
      (e: any) => e.code === 'URL_SCHEME',
      url,
    );
  }
});

test('pins vetted IP across redirects', async () => {
  await withServer(
    (req, res, port) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: `http://rebound.test:${port}/secret` });
        res.end();
        return;
      }
      res.end('internal secret');
    },
    async (port, seen) => {
      const lookups: string[] = [];
      const dialed: string[] = [];
      await assert.rejects(
        () =>
          safeFetch(`http://good.test:${port}/start`, {
            ...base,
            lookup: stubLookup(
              { 'good.test': ['93.184.216.34'], 'rebound.test': ['10.0.0.5'] },
              lookups,
            ),
            dialOverride(address) {
              dialed.push(address);
              return '127.0.0.1';
            },
          }),
        (e: any) => e.code === 'URL_NOT_PUBLIC',
      );
      assert.deepEqual(lookups, ['good.test', 'rebound.test']);
      assert.deepEqual(dialed, ['93.184.216.34']);
      assert.deepEqual(
        seen.map((s) => s.url),
        ['/start'],
      );
    },
  );
});

test('each hop connects to the address it vetted, resolved once', async () => {
  await withServer(
    (req, res, port) => {
      if (req.url === '/a') {
        res.writeHead(301, { location: `http://second.test:${port}/b` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('landed');
    },
    async (port) => {
      const lookups: string[] = [];
      const dialed: string[] = [];
      const result = await safeFetch(`http://first.test:${port}/a`, {
        ...base,
        lookup: stubLookup(
          { 'first.test': ['93.184.216.34'], 'second.test': ['8.8.4.4'] },
          lookups,
        ),
        dialOverride(address) {
          dialed.push(address);
          return '127.0.0.1';
        },
      });
      assert.equal(result.status, 200);
      assert.equal(result.contentType, 'text/plain');
      assert.equal((await drain(result.body)).toString(), 'landed');
      assert.deepEqual(lookups, ['first.test', 'second.test']);
      assert.deepEqual(dialed, ['93.184.216.34', '8.8.4.4']);
    },
  );
});

test('agent headers are dropped on a cross-origin redirect and kept on same-origin', async () => {
  await withServer(
    (req, res, port) => {
      if (req.url === '/cross') {
        res.writeHead(307, { location: `http://other.test:${port}/end` });
        res.end();
        return;
      }
      if (req.url === '/same') {
        res.writeHead(307, { location: '/end' });
        res.end();
        return;
      }
      res.end('done');
    },
    async (port, seen) => {
      const options = {
        ...base,
        headers: { 'x-sample': 'sample header value' },
        lookup: stubLookup({ 'origin.test': ['8.8.8.8'], 'other.test': ['8.8.4.4'] }),
        dialOverride: () => '127.0.0.1',
      };
      await drain((await safeFetch(`http://origin.test:${port}/cross`, options)).body);
      assert.equal(seen[0]!.headers['x-sample'], 'sample header value');
      assert.equal(seen[1]!.headers['x-sample'], undefined);
      seen.length = 0;
      await drain((await safeFetch(`http://origin.test:${port}/same`, options)).body);
      assert.equal(seen[1]!.headers['x-sample'], 'sample header value');
    },
  );
});

test('a redirect loop ends in TOO_MANY_REDIRECTS', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(302, { location: '/again' });
      res.end();
    },
    async (port, seen) => {
      await assert.rejects(
        () =>
          safeFetch(`http://loop.test:${port}/`, {
            ...base,
            lookup: stubLookup({ 'loop.test': ['8.8.8.8'] }),
            dialOverride: () => '127.0.0.1',
          }),
        (e: any) => e.code === 'TOO_MANY_REDIRECTS',
      );
      assert.equal(seen.length, 6);
    },
  );
});

test('a redirect to a non-http scheme is refused', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(302, { location: 'file:///etc/hosts' });
      res.end();
    },
    async (port) => {
      await assert.rejects(
        () =>
          safeFetch(`http://hop.test:${port}/`, {
            ...base,
            lookup: stubLookup({ 'hop.test': ['8.8.8.8'] }),
            dialOverride: () => '127.0.0.1',
          }),
        (e: any) => e.code === 'URL_SCHEME',
      );
    },
  );
});

test('size cap is enforced while streaming and by declared length', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/declared') {
        res.writeHead(200, { 'content-length': '5000' });
        res.end('x'.repeat(5000));
        return;
      }
      res.writeHead(200);
      res.write('x'.repeat(600));
      setTimeout(() => res.end('y'.repeat(600)), 20);
    },
    async (port) => {
      const options = {
        ...base,
        maxBytes: 1000,
        lookup: stubLookup({ 'big.test': ['8.8.8.8'] }),
        dialOverride: () => '127.0.0.1',
      };
      await assert.rejects(
        () => safeFetch(`http://big.test:${port}/declared`, options),
        (e: any) => e.code === 'SIZE_LIMIT',
      );
      const streamed = await safeFetch(`http://big.test:${port}/chunked`, options);
      await assert.rejects(
        () => drain(streamed.body),
        (e: any) => e.code === 'SIZE_LIMIT',
      );
    },
  );
});

test('a stalled response times out', async () => {
  await withServer(
    () => {
      /* never answers */
    },
    async (port) => {
      await assert.rejects(
        () =>
          safeFetch(`http://slow.test:${port}/`, {
            ...base,
            timeoutMs: 150,
            lookup: stubLookup({ 'slow.test': ['8.8.8.8'] }),
            dialOverride: () => '127.0.0.1',
          }),
        (e: any) => e.code === 'URL_TIMEOUT',
      );
    },
  );
});
