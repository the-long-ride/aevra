import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { manageAgent } from '../src/manage.js';
import { workspaceFixture } from './workspace-fixture.js';

const UNVERIFIED = /git could not be found outside the project.*tracking was not checked/;

async function withPath<T>(value: string, run: () => Promise<T>): Promise<T> {
  const before = { PATH: process.env.PATH, Path: process.env.Path };
  delete process.env.Path;
  process.env.PATH = value;
  try {
    return await run();
  } finally {
    for (const [key, saved] of Object.entries(before))
      if (saved === undefined) delete process.env[key];
      else process.env[key] = saved;
  }
}

test('a repository whose git cannot be found gets a note and still installs', async () => {
  const f = workspaceFixture();
  try {
    mkdirSync(path.join(f.root, '.git'));
    const empty = path.join(f.base, 'no-git-here');
    mkdirSync(empty);
    await withPath(empty, async () => {
      const preview = await manageAgent(f.options({ dryRun: true }));
      assert.ok(
        preview.notes.some((note) => UNVERIFIED.test(note)),
        preview.notes.join(' | '),
      );
      const done = await manageAgent(f.options());
      assert.ok(
        done.notes.some((note) => UNVERIFIED.test(note)),
        done.notes.join(' | '),
      );
      assert.equal(done.notes.filter((note) => UNVERIFIED.test(note)).length, 1);
      assert.match(readFileSync(path.join(f.root, '.codex', 'config.toml'), 'utf8'), /aevra/);
      const both = await manageAgent(f.options({ target: 'opencode' }));
      assert.equal(both.notes.filter((note) => UNVERIFIED.test(note)).length, 1);
    });
  } finally {
    f.close();
  }
});

test('a folder that is not a repository gets no git note when git is missing', async () => {
  const f = workspaceFixture();
  try {
    const empty = path.join(f.base, 'no-git-here');
    mkdirSync(empty);
    await withPath(empty, async () => {
      const done = await manageAgent(f.options());
      assert.equal(
        done.notes.some((note) => UNVERIFIED.test(note)),
        false,
      );
    });
  } finally {
    f.close();
  }
});
