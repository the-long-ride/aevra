import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleLocalFilesystemRoutes } from '../src/admin/routes/local-filesystem-routes.js';

function request(method: string) {
  const stream = Readable.from([]) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

test('local filesystem route handler serves directory listings and native picker results', async () => {
  const context = {
    localFilesystem: {
      listDirectories: async () => ({ path: '/srv', parent: '/', directories: [] }),
      pickServerFolder: async () => ({ status: 'selected', path: '/srv' }),
    },
  } as any;

  const listing = response();
  assert.equal(
    await handleLocalFilesystemRoutes(
      request('GET'),
      listing,
      new URL('https://localhost/api/local/directories?path=%2Fsrv'),
      context,
    ),
    true,
  );
  assert.equal(listing.statusCode, 200);
  assert.equal(JSON.parse(listing.body).path, '/srv');

  const picker = response();
  assert.equal(
    await handleLocalFilesystemRoutes(
      request('POST'),
      picker,
      new URL('https://localhost/api/local/folder-picker'),
      context,
    ),
    true,
  );
  assert.equal(picker.statusCode, 200);
  assert.deepEqual(JSON.parse(picker.body), { status: 'selected', path: '/srv' });
});
