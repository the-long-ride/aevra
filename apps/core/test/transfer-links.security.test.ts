import assert from 'node:assert/strict';
import test from 'node:test';
import { TransferLinkStore } from '../src/files/transfer-links.js';

const base = {
  connectionId: 'conn-1',
  sessionId: 'ses-1',
  actor: 'oauth:one',
  workspaceId: 'w1',
  path: '/a/file.bin',
  sha256: 'sha256:abc',
  bytes: 10,
  mimeType: 'application/octet-stream',
};
const secretOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);

function store(now: { t: number } = { t: 1_000_000 }) {
  return {
    now,
    links: new TransferLinkStore(
      () => 'https://aevra.example/',
      () => now.t,
    ),
  };
}

test('mint returns a random url secret and a 5 minute expiry', () => {
  const { links } = store();
  const one = links.mint(base);
  const two = links.mint(base);
  assert.match(one.url, /^https:\/\/aevra\.example\/files\/[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secretOf(one.url), secretOf(two.url));
  assert.equal(Date.parse(one.expiresAt), 1_000_000 + 5 * 60_000);
  assert.notEqual(one.id, two.id);
});

test('the store never holds the secret itself', () => {
  const { links } = store();
  const secret = secretOf(links.mint(base).url);
  assert.ok(!JSON.stringify([...(links as any).byHash.entries()]).includes(secret));
});

test('claim is single use and a held claim blocks a second one', () => {
  const { links } = store();
  const secret = secretOf(links.mint(base).url);
  const first = links.claim(secret);
  assert.equal(first?.path, '/a/file.bin');
  assert.equal(links.claim(secret), null);
  links.complete(first!.id);
  assert.equal(links.claim(secret), null);
});

test('release lets an aborted transfer retry until the ttl', () => {
  const { links, now } = store();
  const secret = secretOf(links.mint(base).url);
  const first = links.claim(secret)!;
  links.release(first.id);
  const again = links.claim(secret);
  assert.equal(again?.id, first.id);
  links.release(again!.id);
  now.t += 5 * 60_000 + 1;
  assert.equal(links.claim(secret), null);
});

test('an expired link is gone', () => {
  const { links, now } = store();
  const secret = secretOf(links.mint(base).url);
  now.t += 5 * 60_000;
  assert.equal(links.claim(secret), null);
});

test('unknown, malformed and empty secrets all give null', () => {
  const { links } = store();
  links.mint(base);
  for (const secret of ['', 'nope', 'x'.repeat(43), 'a'.repeat(5000), undefined as any]) {
    assert.equal(links.claim(secret), null);
  }
});

test('revokeByConnection kills only that connection, in flight too', () => {
  const { links } = store();
  const mine = links.mint(base);
  const other = links.mint({ ...base, connectionId: 'conn-2' });
  const held = links.claim(secretOf(links.mint(base).url))!;
  assert.equal(links.isActive(held.id), true);
  assert.equal(links.revokeByConnection('conn-1'), 2);
  assert.equal(links.isActive(held.id), false);
  assert.equal(links.claim(secretOf(mine.url)), null);
  assert.ok(links.claim(secretOf(other.url)));
});

test('without a public url nothing can be minted', () => {
  const links = new TransferLinkStore(() => undefined);
  assert.equal(links.canMint(), false);
  assert.throws(
    () => links.mint(base),
    (e: any) => e.code === 'PUBLIC_URL_REQUIRED',
  );
});

test('pending links are capped', () => {
  const { links } = store();
  assert.throws(() => {
    for (let i = 0; i < 5000; i += 1) links.mint(base);
  }, /Too many/);
});

test('link single use under race: two parallel claims, one winner', async () => {
  const { links } = store();
  const secret = secretOf(links.mint(base).url);
  const wins = await Promise.all([
    Promise.resolve().then(() => links.claim(secret)),
    Promise.resolve().then(() => links.claim(secret)),
  ]);
  assert.equal(wins.filter(Boolean).length, 1);
});
