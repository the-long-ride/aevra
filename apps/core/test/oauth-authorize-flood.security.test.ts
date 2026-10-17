import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleOAuthRoute } from '../src/mcp/oauth-routes.js';

test('authorization floods stop before creating more requests and the page only advertises real approval UI', async () => {
  let created = 0;
  const oauth: any = {
    beginAuthorization: () => {
      created++;
      return { id: 'request-one', pairingCode: 'PAIR WORDS' };
    },
  };
  let limited = 0;
  for (let i = 0; i < 35; i++) {
    const req: any = Readable.from([]);
    req.method = 'GET';
    req.headers = {};
    req.socket = { remoteAddress: '10.42.123.9' };
    const res: any = {
      statusCode: 0,
      body: '',
      setHeader() {},
      end(value: string) {
        this.body = value;
      },
    };
    await handleOAuthRoute(req, res, new URL('https://localhost/oauth/authorize'), oauth);
    if (res.statusCode === 429) limited++;
    else {
      assert.match(res.body, /local Aevra UI/);
      assert.doesNotMatch(res.body, /aevra oauth approve/);
    }
  }
  assert.equal(created, 30);
  assert.equal(limited, 5);
});
