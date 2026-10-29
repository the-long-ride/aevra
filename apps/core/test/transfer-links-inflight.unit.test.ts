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
const TTL = 5 * 60_000;

function store() {
  const clock = { t: 1_000_000 };
  const links = new TransferLinkStore(
    () => 'https://aevra.example',
    () => clock.t,
  );
  return { clock, links };
}

test('an in-flight link stays active past its ttl', () => {
  const { clock, links } = store();
  const held = links.claim(secretOf(links.mint(base).url))!;
  clock.t += TTL + 60_000;
  assert.equal(links.isActive(held.id), true);
});

test('revoke still kills an in-flight link past its ttl', () => {
  const { clock, links } = store();
  const held = links.claim(secretOf(links.mint(base).url))!;
  clock.t += TTL + 1;
  links.revokeByConnection('conn-1');
  assert.equal(links.isActive(held.id), false);
});

test('a ready link past its ttl is not active and cannot be claimed', () => {
  const { clock, links } = store();
  const minted = links.mint(base);
  clock.t += TTL + 1;
  assert.equal(links.claim(secretOf(minted.url)), null);
  assert.equal(links.isActive(minted.id), false);
});

test('sweep keeps an expired in-flight link but drops an expired ready one', () => {
  const { clock, links } = store();
  const held = links.claim(secretOf(links.mint(base).url))!;
  const idle = links.mint(base);
  clock.t += TTL + 1;
  links.mint(base);
  assert.equal(links.isActive(held.id), true);
  assert.equal(links.isActive(idle.id), false);
});

test('release of an expired link deletes it; complete spends it', () => {
  const { clock, links } = store();
  const held = links.claim(secretOf(links.mint(base).url))!;
  clock.t += TTL + 1;
  links.release(held.id);
  assert.equal(links.isActive(held.id), false);
  const next = links.claim(secretOf(links.mint(base).url))!;
  links.complete(next.id);
  assert.equal(links.isActive(next.id), false);
});
