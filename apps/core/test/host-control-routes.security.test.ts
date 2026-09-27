import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { handleConnectionRoutes } from '../src/admin/routes/connection-routes.js';

test('admin connection control route rejects invalid capabilities and revokes only selected grant', async () => {
  const grants = new Set<string>();
  const context: any = {
    connections: {
      listControl: () => ({
        browser: grants.has('browser.control'),
        desktop: grants.has('desktop.control'),
      }),
      grantControl: (_id: string, capability: string) => grants.add(capability),
      revokeControl: (_id: string, capability: string) => grants.delete(capability),
    },
  };
  async function call(method: string, path: string, body?: object) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []) as any;
    req.method = method;
    req.headers = body ? { 'content-type': 'application/json' } : {};
    const res: any = {
      statusCode: 0,
      body: '',
      setHeader() {},
      end(value = '') {
        this.body = String(value);
      },
    };
    const handled = await handleConnectionRoutes(
      req,
      res,
      new URL(`https://localhost${path}`),
      context,
    );
    return { handled, status: res.statusCode, value: JSON.parse(res.body || '{}') };
  }
  assert.equal(
    (await call('POST', '/api/connections/one/control', { capability: 'files.read' })).status,
    400,
  );
  assert.equal(
    (await call('POST', '/api/connections/one/control', { capability: 'browser.control' })).status,
    200,
  );
  assert.equal((await call('GET', '/api/connections/one/control')).value.browser, true);
  assert.equal((await call('DELETE', '/api/connections/one/control/browser.control')).status, 200);
  assert.equal((await call('GET', '/api/connections/one/control')).value.browser, false);
});
