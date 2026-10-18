import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { workspaceFixture } from './workspace-fixture.js';

const REFRESHED = /credential file refreshed/;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const parsed = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;

test('install again after an endpoint or CA change rewrites the stdio credential file', async () => {
  const f = workspaceFixture();
  try {
    const first = await manageAgent(f.options());
    const [reg] = first.registrations;
    const before = parsed(reg.credentialFile);
    const config = readFileSync(reg.config, 'utf8');
    const moved = { endpoint: 'https://localhost:48000/mcp', caFile: path.join(f.base, 'ca.pem') };

    const preview = await manageAgent(f.options({ ...moved, dryRun: true }));
    assert.ok(
      preview.notes.some((note) => REFRESHED.test(note)),
      preview.notes.join(' | '),
    );
    assert.deepEqual(parsed(reg.credentialFile), before);

    const second = await manageAgent(f.options(moved));
    assert.deepEqual(second.changes, []);
    assert.ok(
      second.notes.some((note) => REFRESHED.test(note)),
      second.notes.join(' | '),
    );
    const after = parsed(reg.credentialFile);
    assert.equal(after.endpoint, moved.endpoint);
    assert.equal(after.caFile, moved.caFile);
    assert.equal(after.id, before.id);
    assert.ok(after.token === before.token, 'the stored credential must be kept');
    assert.equal(readFileSync(reg.config, 'utf8'), config);
    const [updated] = second.registrations;
    assert.equal(updated.credentialId, reg.credentialId);
    assert.equal(updated.credentialFile, reg.credentialFile);
    assert.equal(updated.credentialHash, sha(readFileSync(reg.credentialFile, 'utf8')));
    assert.equal(updated.entryHash, reg.entryHash);
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.revoked, []);
    const status = await manageAgent(f.options({ ...moved, operation: 'status' }));
    assert.equal(status.registrations[0].state, 'installed');

    const text = readFileSync(reg.credentialFile, 'utf8');
    const same = await manageAgent(f.options(moved));
    assert.deepEqual(same.changes, []);
    assert.equal(
      same.notes.some((note) => REFRESHED.test(note)),
      false,
    );
    assert.equal(readFileSync(reg.credentialFile, 'utf8'), text);

    const removed = await manageAgent(f.options({ ...moved, operation: 'uninstall' }));
    assert.deepEqual(
      removed.changes.map((change) => change.action),
      ['remove'],
    );
    assert.deepEqual(f.revoked, [reg.credentialId]);
  } finally {
    f.close();
  }
});

test('a failed install puts a refreshed credential file and the manifest back', async () => {
  const f = workspaceFixture();
  try {
    const [reg] = (await manageAgent(f.options())).registrations;
    const before = readFileSync(reg.credentialFile, 'utf8');
    const manifest = path.join(f.home, '.agents', 'aevra', 'aevra.json');
    const manifestBefore = readFileSync(manifest, 'utf8');
    const failing = {
      async create(): Promise<never> {
        throw new Error('plain failure');
      },
      async revoke() {},
    };
    const moved = { target: 'all' as const, endpoint: 'https://localhost:48000/mcp' };
    await assert.rejects(
      manageAgent(f.options({ ...moved, credentials: failing })),
      /plain failure/,
    );
    assert.equal(readFileSync(reg.credentialFile, 'utf8'), before);
    assert.equal(readFileSync(manifest, 'utf8'), manifestBefore);
  } finally {
    f.close();
  }
});

test('install again after an endpoint change rewrites an HTTP entry with the same credential', async () => {
  const f = workspaceFixture();
  const http = { scope: 'user' as const, workspaceRoot: undefined, transport: 'http' as const };
  try {
    const first = await manageAgent(f.options(http));
    const [reg] = first.registrations;
    const config = readFileSync(reg.config, 'utf8');
    assert.match(config, /localhost:47832/);
    const moved = { ...http, endpoint: 'https://localhost:48000/mcp' };

    const preview = await manageAgent(f.options({ ...moved, dryRun: true }));
    assert.deepEqual(preview.changes, [{ target: 'codex', file: reg.config, action: 'update' }]);
    assert.equal(readFileSync(reg.config, 'utf8'), config);

    const second = await manageAgent(f.options(moved));
    assert.deepEqual(second.changes, [{ target: 'codex', file: reg.config, action: 'update' }]);
    const text = readFileSync(reg.config, 'utf8');
    assert.match(text, /localhost:48000/);
    assert.doesNotMatch(text, /localhost:47832/);
    assert.ok(text.includes('Bearer pelican'), 'the stored credential must be reused');
    assert.equal(parsed(reg.credentialFile).endpoint, moved.endpoint);
    const [updated] = second.registrations;
    assert.equal(updated.credentialId, reg.credentialId);
    assert.notEqual(updated.entryHash, reg.entryHash);
    assert.equal(updated.credentialHash, sha(readFileSync(reg.credentialFile, 'utf8')));
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.revoked, []);

    const same = await manageAgent(f.options(moved));
    assert.deepEqual(same.changes, []);
    assert.equal(readFileSync(reg.config, 'utf8'), text);

    const removed = await manageAgent(f.options({ ...moved, operation: 'uninstall' }));
    assert.deepEqual(
      removed.changes.map((change) => change.action),
      ['remove'],
    );
    assert.doesNotMatch(readFileSync(reg.config, 'utf8'), /localhost/);
    assert.deepEqual(f.revoked, [reg.credentialId]);
  } finally {
    f.close();
  }
});
