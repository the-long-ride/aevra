import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { loadManifest, preflight, resolveScope, selectionsFor } from '../src/manage-plan.js';
import { gitContext } from '../src/project-guard.js';
import { workspaceFixture } from './workspace-fixture.js';

// Counts the reads the engine makes of each variable through `options.env`.
function counted(base: Record<string, string | undefined>) {
  const reads = new Map<string, number>();
  const env = new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key === 'string') reads.set(key, (reads.get(key) ?? 0) + 1);
      return Reflect.get(target, key, receiver);
    },
  });
  return { env, reads: (key: string) => reads.get(key) ?? 0 };
}

test('an install plans once: config locations resolve as often as for a dry run', async () => {
  const dry = workspaceFixture();
  const real = workspaceFixture();
  try {
    const preview = counted({});
    await manageAgent(dry.options({ env: preview.env, dryRun: true }));
    const install = counted({});
    await manageAgent(real.options({ env: install.env }));
    assert.ok(preview.reads('CODEX_HOME') > 0);
    assert.equal(install.reads('CODEX_HOME'), preview.reads('CODEX_HOME'));
  } finally {
    dry.close();
    real.close();
  }
});

test('the refresh is planned once and carried on the planned item', async () => {
  const f = workspaceFixture();
  try {
    await manageAgent(f.options({ executable: 'old-runner' }));
    const options = f.options({ executable: 'new-runner' });
    const manifest = loadManifest(options);
    const picks = selectionsFor(options, manifest, ['codex'], resolveScope(options));
    const [item] = preflight(options, manifest, picks, true);
    assert.ok(item.refresh?.entry, 'a new launcher must be planned as an entry refresh');
    assert.equal(item.refresh?.secret, undefined);
  } finally {
    f.close();
  }
});

test('git is located once per call and folder, through options.env', async () => {
  const f = workspaceFixture();
  try {
    const { env, reads } = counted({ PATH: path.join(f.base, 'no-git-here') });
    await manageAgent(f.options({ target: 'all', env }));
    assert.equal(reads('PATH'), 1);
  } finally {
    f.close();
  }
});

test('a repository is unverified when options.env has no git, whatever process.env holds', async () => {
  const f = workspaceFixture();
  try {
    mkdirSync(path.join(f.root, '.git'));
    const done = await manageAgent(f.options({ env: { PATH: path.join(f.base, 'no-git-here') } }));
    assert.ok(
      done.notes.some((note) => /git could not be found outside the project/.test(note)),
      done.notes.join(' | '),
    );
  } finally {
    f.close();
  }
});

test('gitContext looks git up once per folder and reuses it', () => {
  const f = workspaceFixture();
  try {
    const seen: string[] = [];
    const context = gitContext({}, (root) => {
      seen.push(root);
      return null;
    });
    assert.equal(context.run(f.root, ['status']).missing, true);
    assert.equal(context.run(f.root, ['status']).missing, true);
    assert.equal(context.unverified(f.root), false);
    context.run(f.base, ['status']);
    assert.deepEqual(seen, [f.root, f.base]);
  } finally {
    f.close();
  }
});
