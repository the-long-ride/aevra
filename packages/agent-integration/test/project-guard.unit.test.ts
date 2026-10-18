import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertNotTracked,
  excludeFromGit,
  runGit,
  type GitResult,
  type GitRunner,
} from '../src/project-guard.js';
import { manageAgent } from '../src/manage.js';
import { git, gitAvailable, workspaceFixture } from './workspace-fixture.js';

const identity = ['-c', 'user.name=tester', '-c', 'user.email=tester@example.invalid'];

function repo(root: string) {
  git(root, 'init');
}

test('a missing file, or a folder that is not a work tree, is never reported as tracked', (t) => {
  const f = workspaceFixture();
  try {
    const file = path.join(f.root, 'opencode.json');
    assertNotTracked(file, f.root);
    writeFileSync(file, '{}');
    assertNotTracked(file, f.root);
    if (gitAvailable()) {
      repo(f.root);
      assertNotTracked(file, f.root);
    } else t.diagnostic('git unavailable: work tree cases skipped');
    assert.equal(
      excludeFromGit(path.join(f.base, 'nowhere/file'), path.join(f.base, 'nowhere')),
      'skipped',
    );
  } finally {
    f.close();
  }
});

test('assertNotTracked throws for a tracked file and names it', (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  try {
    repo(f.root);
    const file = path.join(f.root, 'opencode.json');
    writeFileSync(file, '{}');
    git(f.root, 'add', 'opencode.json');
    assert.throws(
      () => assertNotTracked(file, f.root),
      (error: Error) => error.message === `AGENT_PROJECT_FILE_TRACKED: ${file}`,
    );
  } finally {
    f.close();
  }
});

test('excludeFromGit appends once, anchored to the repository top level', (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  try {
    repo(f.base);
    const file = path.join(f.root, 'opencode.json');
    assert.equal(excludeFromGit(file, f.root, false), 'excluded');
    const exclude = path.join(f.base, '.git/info/exclude');
    assert.ok(!readFileSync(exclude, 'utf8').includes('opencode.json'));
    assert.equal(excludeFromGit(file, f.root), 'excluded');
    assert.equal(excludeFromGit(file, f.root), 'already');
    const lines = readFileSync(exclude, 'utf8').split('\n');
    assert.equal(lines.filter((line) => line === '/project/opencode.json').length, 1);
    writeFileSync(file, '{}');
    git(f.root, 'check-ignore', '-q', 'opencode.json');
  } finally {
    f.close();
  }
});

test('a linked worktree writes to the shared repository exclude file', (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  try {
    repo(f.root);
    git(f.root, ...identity, 'commit', '--allow-empty', '-m', 'start');
    const linked = path.join(f.base, 'linked');
    git(f.root, 'worktree', 'add', linked);
    assert.ok(readFileSync(path.join(linked, '.git'), 'utf8').startsWith('gitdir:'));
    const file = path.join(linked, 'opencode.json');
    assert.equal(excludeFromGit(file, linked), 'excluded');
    assert.equal(excludeFromGit(file, linked), 'already');
    const shared = readFileSync(path.join(f.root, '.git/info/exclude'), 'utf8');
    assert.equal(shared.split('\n').filter((line) => line === '/opencode.json').length, 1);
  } finally {
    f.close();
  }
});

test('install refuses a tracked project file and writes nothing', async (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  try {
    repo(f.root);
    const file = path.join(f.root, '.codex/config.toml');
    mkdirSync(path.dirname(file));
    writeFileSync(file, 'model = "plain"\n');
    git(f.root, 'add', '.codex/config.toml');
    await assert.rejects(manageAgent(f.options()), /AGENT_PROJECT_FILE_TRACKED/);
    await assert.rejects(manageAgent(f.options({ dryRun: true })), /AGENT_PROJECT_FILE_TRACKED/);
    assert.equal(readFileSync(file, 'utf8'), 'model = "plain"\n');
    assert.equal(f.created.length, 0);
    assert.ok(!existsSync(path.join(f.home, '.agents')));
    assert.ok(
      !existsSync(path.join(f.root, '.git/info/exclude')) ||
        !/codex/.test(readFileSync(path.join(f.root, '.git/info/exclude'), 'utf8')),
    );
  } finally {
    f.close();
  }
});

test('install in a plain folder notes the skipped exclude and in a repository excludes once', async (t) => {
  const f = workspaceFixture();
  try {
    const plain = await manageAgent(f.options({ target: 'codex' }));
    assert.ok(plain.notes.some((note) => /skipped/.test(note)));
    if (!gitAvailable()) return t.skip('git unavailable');
    await manageAgent(f.options({ target: 'codex', operation: 'uninstall' }));
    repo(f.root);
    const first = await manageAgent(f.options({ target: 'codex' }));
    assert.ok(first.notes.some((note) => /excluded/.test(note)));
    await manageAgent(f.options({ target: 'codex' }));
    const exclude = readFileSync(path.join(f.root, '.git/info/exclude'), 'utf8');
    assert.equal(exclude.split('\n').filter((line) => line === '/.codex/config.toml').length, 1);
    assert.equal(git(f.root, 'status', '--porcelain').includes('.codex'), false);
    assert.ok(readdirSync(f.root).includes('.codex'));
  } finally {
    f.close();
  }
});

test('Claude workspace install never writes into the project folder', async (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  try {
    repo(f.root);
    await manageAgent(f.options({ target: 'claude-code' }));
    assert.deepEqual(readdirSync(f.root), ['.git']);
    assert.ok(!/claude/i.test(readFileSync(path.join(f.root, '.git/info/exclude'), 'utf8')));
  } finally {
    f.close();
  }
});

const stub =
  (result: Partial<GitResult>): GitRunner =>
  () => ({ missing: false, status: 0, stdout: '', stderr: '', ...result });

test('assertNotTracked reads git exit codes: 0 tracked, 1 untracked, not-a-repo and no git skip', () => {
  const file = path.join('some', 'opencode.json');
  const tracked = `AGENT_PROJECT_FILE_TRACKED: ${file}`;
  assert.throws(() => assertNotTracked(file, 'some', stub({ status: 0 })), { message: tracked });
  assertNotTracked(file, 'some', stub({ status: 1 }));
  assertNotTracked(file, 'some', stub({ missing: true, status: null }));
  assertNotTracked(
    file,
    'some',
    stub({
      status: 128,
      stderr: 'fatal: not a git repository (or any of the parent directories)\n',
    }),
  );
});

test('assertNotTracked refuses when git fails for any other reason', () => {
  const file = path.join('some', 'opencode.json');
  const head = `AGENT_PROJECT_FILE_TRACKED: could not verify git tracking for ${file}: `;
  const ownership = 'fatal: detected dubious ownership in repository at x';
  assert.throws(
    () => assertNotTracked(file, 'some', stub({ status: 128, stderr: `${ownership}\nhint\n` })),
    { message: `${head}${ownership}` },
  );
  assert.throws(() => assertNotTracked(file, 'some', stub({ status: null })), {
    message: `${head}git exited with null`,
  });
});

test('git runs with the repository fsmonitor hook disabled', (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  try {
    const result = runGit(f.root, ['config', '--get', 'core.fsmonitor']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'false');
  } finally {
    f.close();
  }
});

test('a tracked file that was deleted from disk still refuses and is not recreated', async (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  try {
    repo(f.root);
    const file = path.join(f.root, '.codex/config.toml');
    mkdirSync(path.dirname(file));
    writeFileSync(file, 'model = "plain"\n');
    git(f.root, 'add', '.codex/config.toml');
    rmSync(file);
    assert.throws(() => assertNotTracked(file, f.root), /AGENT_PROJECT_FILE_TRACKED: /);
    await assert.rejects(manageAgent(f.options()), /AGENT_PROJECT_FILE_TRACKED: /);
    assert.ok(!existsSync(file));
    assert.equal(f.created.length, 0);
  } finally {
    f.close();
  }
});

test('a git failure other than not-a-repository refuses the install and writes nothing', async (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  try {
    repo(f.root);
    writeFileSync(path.join(f.root, '.git/index'), 'plain words, not an index');
    await assert.rejects(
      manageAgent(f.options({ target: 'opencode' })),
      /AGENT_PROJECT_FILE_TRACKED: could not verify git tracking for .*opencode\.json: /,
    );
    assert.deepEqual(readdirSync(f.root), ['.git']);
    assert.equal(f.created.length, 0);
    assert.deepEqual(readdirSync(f.home), []);
  } finally {
    f.close();
  }
});

// Revoking a retired credential happens after the manifest write, so its failure keeps the
// committed install (new entry, new credential, exclude line) and names the credential still
// to revoke instead of rolling back to an entry that may name a revoked one.
test('a failed revoke of a retired credential keeps the committed install and names it', async (t) => {
  if (!gitAvailable()) return t.skip('git unavailable');
  const f = workspaceFixture();
  const revoked: string[] = [];
  let issued = 0;
  const credentials = {
    async create() {
      return { id: `cred-heron-${++issued}`, token: 'pelican' };
    },
    async revoke(id: string) {
      revoked.push(id);
      if (id === 'cred-heron-1') throw new Error('provider offline');
    },
  };
  try {
    repo(f.root);
    const exclude = path.join(f.root, '.git/info/exclude');
    const pristine = readFileSync(exclude, 'utf8');
    const options = f.options({ target: 'opencode', credentials });
    await manageAgent(options);
    assert.match(readFileSync(exclude, 'utf8'), /\/opencode\.json/);
    // Owner removed our entry and the exclude line; reinstall must retire the first credential.
    const config = path.join(f.root, 'opencode.json');
    writeFileSync(config, '{\n  "theme": "plain"\n}\n');
    writeFileSync(exclude, pristine);
    await assert.rejects(manageAgent(options), {
      message: 'AGENT_REVOKE_INCOMPLETE: revoke credentials cred-heron-1',
    });
    assert.match(readFileSync(config, 'utf8'), /"theme": "plain"/);
    assert.match(readFileSync(config, 'utf8'), /aevra/);
    assert.match(readFileSync(exclude, 'utf8'), /\/opencode\.json/);
    assert.deepEqual(revoked, ['cred-heron-1']);
    const status = await manageAgent(f.options({ operation: 'status' }));
    assert.deepEqual(
      status.registrations.map((reg) => [reg.credentialId, reg.state]),
      [['cred-heron-2', 'installed']],
    );
    assert.equal(readdirSync(path.join(f.home, 'state/agent-credentials')).length, 1);
  } finally {
    f.close();
  }
});
