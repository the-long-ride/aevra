import assert from 'node:assert/strict';
import test from 'node:test';
import { fileLinksFor } from '../src/files/runtime-file-links.js';
import { exposureOrigins } from '../src/exposure/exposure-origins.js';

function rig(states: Record<string, string> = {}, live: string[] = []) {
  let revoker: ((key: string) => void) | undefined;
  const sessions = {
    set linkRevoker(fn: (key: string) => void) {
      revoker = fn;
    },
    connectionState: (key: string) => (states[key] ? { status: states[key] } : null),
    get: (id: string) => (live.includes(id) ? { id } : null),
  };
  const exposure = {
    publicUrl: () => 'https://aevra.example',
    oauth: {
      verifyAccessToken(token: string) {
        if (token !== 'sample header value') throw new Error('invalid');
        return { actor: 'oauth:one', connectionId: 'conn-1' };
      },
    },
  };
  const parts = fileLinksFor(
    sessions as any,
    { capabilityRoots: () => [] } as any,
    {},
    { append() {} } as any,
    exposure as any,
  );
  return { parts, revoke: (key: string) => revoker!(key) };
}

const input = {
  connectionId: 'conn-1',
  sessionId: 'ses-1',
  actor: 'oauth:one',
  workspaceId: 'w1',
  path: '/a/file.bin',
  sha256: 'sha256:abc',
  bytes: 1,
  mimeType: 'application/octet-stream',
};

test('the store mints against the exposure public url and the session revoker kills its links', () => {
  const { parts, revoke } = rig();
  const links = parts.tools.transferLinks;
  assert.equal(links.canMint(), true);
  const minted = links.mint(input);
  assert.match(minted.url, /^https:\/\/aevra\.example\/files\//);
  revoke('conn-1');
  assert.equal(links.claim(minted.url.slice(minted.url.lastIndexOf('/') + 1)), null);
});

test('the route answers 404 for an unknown link', async () => {
  const { parts } = rig({ 'conn-1': 'CONNECTED' });
  let status = 0;
  const res: any = {
    setHeader() {},
    end() {},
    set statusCode(value: number) {
      status = value;
    },
  };
  await parts.mcp.fileLinks(
    { method: 'GET', headers: {} } as any,
    res,
    new URL('http://x/files/nope'),
  );
  assert.equal(status, 404);
});

test('exposureOrigins lists the gateway, public and admin origins lazily', () => {
  assert.deepEqual(exposureOrigins(undefined), [undefined, undefined, undefined]);
  const origins = exposureOrigins({
    gatewayUrl: () => 'a',
    publicUrl: () => 'b',
    adminPublicUrl: () => undefined,
    trustedAdminOrigins: () => ['c'],
  });
  assert.deepEqual(origins, ['a', 'b', undefined, 'c']);
});

test('a static connector bearer is resolved through the connector admission by actor', async () => {
  const connectors = {
    verify: async (token: string) =>
      token === 'plain connector words'
        ? { kind: 'admitted', identity: { actor: 'connector:one' } }
        : { kind: 'denied' },
  };
  const sessions = {
    set linkRevoker(_fn: unknown) {},
    connectionState: () => null,
    get: () => ({}),
  };
  const parts = fileLinksFor(
    sessions as any,
    { capabilityRoots: () => [] } as any,
    {},
    { append() {} } as any,
    { publicUrl: () => 'https://aevra.example', oauth: { verifyAccessToken: () => null } } as any,
    () => connectors as any,
  );
  const fetchWith = async (token: string) => {
    const minted = parts.tools.transferLinks.mint({
      ...input,
      connectionId: 'ses-1',
      actor: 'connector:one',
    });
    let status = 0;
    const res: any = {
      setHeader() {},
      end() {},
      set statusCode(value: number) {
        status = value;
      },
    };
    await parts.mcp.fileLinks(
      { method: 'GET', headers: { authorization: `Bearer ${token}` }, socket: {} } as any,
      res,
      new URL(`http://x/files/${minted.url.slice(minted.url.lastIndexOf('/') + 1)}`),
    );
    return status;
  };
  assert.equal(await fetchWith('plain connector words'), 503);
  assert.equal(await fetchWith('other words'), 404);
});
