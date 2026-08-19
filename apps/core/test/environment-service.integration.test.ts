import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { EnvironmentService } from '../src/secrets/environment-service.js';
test('remote metadata never includes secret value', async () => {
  const db = AevraDatabase.open(':memory:');
  const store = {
    async set() {},
    async get() {
      return 'top-secret';
    },
    async delete() {},
  };
  const s = new EnvironmentService(db.raw(), store);
  const p = s.create('Dev', { MODE: 'dev' }, { TOKEN: 'ref' });
  const r = await s.resolve(p.id);
  assert.equal(r.env.TOKEN, 'top-secret');
  assert.equal(JSON.stringify(r.metadata).includes('top-secret'), false);
  db.close();
});
