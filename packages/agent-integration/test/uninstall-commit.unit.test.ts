import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { git, gitAvailable, workspaceFixture } from './workspace-fixture.js';

const userScope = { scope: 'user' as const, workspaceRoot: undefined };

// Makes `file` refuse a replace: read-only file (Windows) and read-only folder (POSIX). False
// when this account can still replace it (for example root on POSIX), so the caller skips.
function lockFile(file: string): boolean {
  const content = readFileSync(file, 'utf8');
  chmodSync(file, 0o444);
  chmodSync(path.dirname(file), 0o555);
  const probe = `${file}.probe`;
  try {
    writeFileSync(probe, content);
    renameSync(probe, file);
  } catch {
    if (existsSync(probe)) unlinkSync(probe);
    return true;
  }
  return false;
}

function unlockFile(file: string): void {
  if (!existsSync(file)) return;
  chmodSync(path.dirname(file), 0o755);
  chmodSync(file, 0o644);
}

test('an uninstall whose second edit fails revokes nothing and restores the first entry', async (t) => {
  const f = workspaceFixture();
  const config = path.join(f.root, '.codex', 'config.toml');
  try {
    const user = await manageAgent(f.options(userScope));
    await manageAgent(f.options());
    const userConfig = user.registrations[0].config;
    const before = readFileSync(userConfig, 'utf8');
    if (!lockFile(config)) return t.skip('this account can replace read-only files');
    await assert.rejects(
      manageAgent(f.options({ operation: 'uninstall', scope: 'all', workspaceRoot: undefined })),
    );
    assert.deepEqual(f.revoked, []);
    assert.equal(readFileSync(userConfig, 'utf8'), before);
    const status = await manageAgent(f.options({ operation: 'status' }));
    assert.deepEqual(
      status.registrations.map((reg) => [reg.scope, reg.state]),
      [
        ['user', 'installed'],
        ['workspace', 'installed'],
      ],
    );
  } finally {
    unlockFile(config);
    f.close();
  }
});

test('a git exclude failure after the manifest write is a note, not a rollback', async (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  try {
    git(f.root, 'init', '-q');
    const options = f.options({ target: 'opencode' });
    const [old] = (await manageAgent(options)).registrations;
    // The owner removed our entry, so the next install retires the first credential.
    writeFileSync(old.config, '{\n  "theme": "plain"\n}\n');
    const exclude = path.join(f.root, '.git', 'info', 'exclude');
    rmSync(exclude, { force: true });
    mkdirSync(exclude, { recursive: true });
    const second = await manageAgent(options);
    assert.ok(
      second.notes.some((note) => /^opencode: git exclude: failed \(/.test(note)),
      second.notes.join(' | '),
    );
    const [reg] = second.registrations;
    assert.equal(second.registrations.length, 1);
    assert.notEqual(reg.credentialId, old.credentialId);
    assert.deepEqual(f.revoked, [old.credentialId]);
    assert.ok(existsSync(reg.credentialFile));
    assert.ok(!existsSync(old.credentialFile));
    assert.match(readFileSync(reg.config, 'utf8'), /aevra/);
    const manifest = JSON.parse(
      readFileSync(path.join(f.home, '.agents', 'aevra', 'aevra.json'), 'utf8'),
    );
    assert.deepEqual(
      manifest.registrations.map((row: { credentialId: string }) => row.credentialId),
      [reg.credentialId],
    );
  } finally {
    f.close();
  }
});

test('a failed revoke after uninstall keeps the files committed and names the credential', async () => {
  const f = workspaceFixture();
  try {
    const [reg] = (await manageAgent(f.options())).registrations;
    const credentials = {
      async create(): Promise<never> {
        throw new Error('not used here');
      },
      async revoke(): Promise<void> {
        throw new Error('provider offline');
      },
    };
    await assert.rejects(manageAgent(f.options({ operation: 'uninstall', credentials })), {
      message: `AGENT_REVOKE_INCOMPLETE: revoke credentials ${reg.credentialId}`,
    });
    assert.doesNotMatch(readFileSync(reg.config, 'utf8'), /aevra/);
    assert.ok(!existsSync(reg.credentialFile));
    const status = await manageAgent(f.options({ operation: 'status' }));
    assert.deepEqual(status.registrations, []);
    assert.ok(!existsSync(path.join(f.home, '.agents', 'aevra', 'integration.lock')));
  } finally {
    f.close();
  }
});
