import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadCoreConfig } from '../src/config.js';
import { createCoreRuntime } from '../src/runtime.js';
import { ensureLocalTls, localTlsPaths } from '../src/tls/local-tls.js';

async function getJson(url: string, caPath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { ca: readFileSync(caPath), servername: 'localhost' },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.once('error', reject);
  });
}

test('integrity failure starts admin safe mode without worker authority', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-safe-'));
  let workerStarts = 0;
  const fakeDb: any = {
    integrityCheck() {
      return { ok: false, message: 'bad' };
    },
    raw() {
      return {
        prepare() {
          return { get() {}, run() {} };
        },
        exec() {},
      };
    },
    close() {},
  };
  const worker = {
    async start() {
      workerStarts++;
      throw new Error('must not start');
    },
    async close() {},
  };
  const c = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: d,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'secret',
    }),
    publicPort: 0,
    adminPort: 0,
    mcpPort: 0,
  };
  const r = await createCoreRuntime(c, {
    worker,
    databaseOpen: () => fakeDb,
    ensureTls: (config) => ensureLocalTls(config.stateDir, { trust: false }),
  });

  await r.start();
  try {
    const health = await getJson(`${r.adminUrl}/api/health`, localTlsPaths(d).certificatePath);
    assert.equal(health.safeMode, true);
    assert.equal(workerStarts, 0);
  } finally {
    await r.close();
  }
});
