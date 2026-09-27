import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { SkillsService, parseFrontmatter } from '../src/skills/skills-service.js';

const CAP = 256 * 1024;

function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-skills-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'ws');
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const skill = (base: string, dir: string, body: string) => {
    const full = path.join(base, '.agents', 'skills', dir);
    mkdirSync(full, { recursive: true });
    writeFileSync(path.join(full, 'SKILL.md'), body);
    return full;
  };
  return { root, home, workspace, skill, service: new SkillsService(home) };
}

const code = (expected: string) => (error: any) => error?.code === expected;

test('parseFrontmatter ignores unterminated blocks and unrelated lines', () => {
  assert.deepEqual(parseFrontmatter('plain text'), {});
  assert.deepEqual(parseFrontmatter('---\nname: open'), {});
  assert.deepEqual(
    parseFrontmatter('---\nname:  alpha \n- bullet\nother: x\ndescription: beta\n---\nbody'),
    {
      name: 'alpha',
      description: 'beta',
    },
  );
});

test('list skips missing bases, loose files, and directories without SKILL.md', (t) => {
  const { home, workspace, skill, service } = setup(t);
  assert.deepEqual(service.list(null), []);
  skill(home, 'named', '---\nname: custom\ndescription: user skill\n---\n');
  skill(home, 'plain', 'no frontmatter');
  mkdirSync(path.join(home, '.agents', 'skills', 'empty'), { recursive: true });
  writeFileSync(path.join(home, '.agents', 'skills', 'loose.md'), 'loose');
  skill(workspace, 'local', '---\nname:   \n---\n');
  const names = service
    .list(workspace)
    .map((s) => `${s.source}:${s.name}:${s.description}`)
    .sort();
  assert.deepEqual(names, ['user:custom:user skill', 'user:plain:', 'workspace:local:']);
});

test('read reports missing workspace, skill, file, and directory targets', (t) => {
  const { root, workspace, skill, service } = setup(t);
  assert.throws(() => service.read('workspace', 'x', null), code('SKILL_NOT_FOUND'));
  assert.throws(() => service.read('workspace', 'x', workspace), /Skill x not found/);
  const dir = skill(workspace, 'tool', '---\ndescription: tool skill\n---\nbody');
  mkdirSync(path.join(dir, 'nested'));
  assert.throws(() => service.read('workspace', 'tool', workspace, 'missing.md'), /File not found/);
  assert.throws(
    () => service.read('workspace', 'tool', workspace, 'nested'),
    /Path is a directory/,
  );
  writeFileSync(path.join(root, 'outside.md'), 'outside');
  assert.throws(
    () => service.read('workspace', 'tool', workspace, '../../../../outside.md'),
    code('SKILL_PATH_ESCAPE'),
  );
  writeFileSync(path.join(dir, 'big.md'), 'a'.repeat(CAP + 1));
  assert.throws(
    () => service.read('workspace', 'tool', workspace, 'big.md'),
    code('SKILL_FILE_TOO_LARGE'),
  );
});

test('read returns skill content, sibling files, and masks secret files', (t) => {
  const { workspace, skill, service } = setup(t);
  const dir = skill(workspace, 'tool', '---\ndescription: tool skill\n---\nbody words');
  writeFileSync(path.join(dir, 'notes.md'), 'sample notes');
  writeFileSync(path.join(dir, '.env'), 'GREETING=sample value\n');
  const main = service.read('workspace', 'tool', workspace);
  assert.equal(main.content.endsWith('body words'), true);
  assert.equal(main.sensitivity, 'NORMAL');
  assert.deepEqual(main.skill, { name: 'tool', source: 'workspace', description: 'tool skill' });
  assert.deepEqual(main.files.sort(), ['.env', 'notes.md']);
  const secret = service.read('workspace', 'tool', workspace, '.env');
  assert.equal(secret.sensitivity, 'SECRET');
  assert.equal(secret.content.includes('sample value'), false);
  const noDescription = skill(workspace, 'bare', 'no frontmatter');
  assert.ok(noDescription);
  assert.equal(service.read('workspace', 'bare', workspace).skill.description, '');
});

test('write validates size, workspace, skill, and relative path shape', (t) => {
  const { workspace, skill, service } = setup(t);
  assert.throws(
    () => service.write('user', 'x', null, undefined, 'a'.repeat(CAP + 1)),
    code('SKILL_FILE_TOO_LARGE'),
  );
  assert.throws(
    () => service.write('workspace', 'x', null, undefined, 'text'),
    /No workspace is active/,
  );
  assert.throws(
    () => service.write('workspace', 'x', workspace, undefined, 'text'),
    /Skill x not found/,
  );
  skill(workspace, 'tool', 'body');
  const write = (file: string) => () => service.write('workspace', 'tool', workspace, file, 'text');
  assert.throws(write(path.resolve(workspace, 'abs.md')), /must be relative/);
  assert.throws(write('a/../b.md'), /escapes the skill directory/);
  assert.throws(write('./b.md'), /escapes the skill directory/);
  assert.throws(write('///'), /must be relative|escapes/);
});

test('write creates nested directories, overwrites files, and refuses unsafe targets', (t) => {
  const { workspace, skill, service } = setup(t);
  const dir = skill(workspace, 'tool', 'body');
  const result = service.write(
    'workspace',
    'tool',
    workspace,
    'docs\\deep\\guide.md',
    'guide words',
  );
  assert.deepEqual(result, {
    source: 'workspace',
    name: 'tool',
    file: 'docs/deep/guide.md',
    sizeBytes: 11,
  });
  assert.equal(readFileSync(path.join(dir, 'docs', 'deep', 'guide.md'), 'utf8'), 'guide words');
  service.write('workspace', 'tool', workspace, 'docs/deep/guide.md', 'second words');
  assert.equal(readFileSync(path.join(dir, 'docs', 'deep', 'guide.md'), 'utf8'), 'second words');
  assert.equal(service.write('workspace', 'tool', workspace, '  ', 'main').file, 'SKILL.md');
  writeFileSync(path.join(dir, 'blocker'), 'file');
  assert.throws(
    () => service.write('workspace', 'tool', workspace, 'blocker/x.md', 'x'),
    /not a safe directory/,
  );
  assert.throws(
    () => service.write('workspace', 'tool', workspace, 'docs', 'x'),
    /not a regular file/,
  );
});

test('write refuses junction parents and targets that leave the skill directory', (t) => {
  const { root, workspace, skill, service } = setup(t);
  const dir = skill(workspace, 'tool', 'body');
  const outside = path.join(root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, path.join(dir, 'link'), 'junction');
  assert.throws(
    () => service.write('workspace', 'tool', workspace, 'link/x.md', 'x'),
    /not a safe directory/,
  );
  assert.throws(
    () => service.write('workspace', 'tool', workspace, 'link', 'x'),
    /not a regular file/,
  );
});

test('instructions prefer AGENTS.md, fall back to CLAUDE.md, and report none', (t) => {
  const { home, workspace, service } = setup(t);
  assert.deepEqual(service.instructions(null), {
    instructions: [],
    note: 'no instruction files found',
  });
  writeFileSync(path.join(workspace, 'CLAUDE.md'), 'claude words');
  assert.deepEqual(service.instructions(workspace), {
    instructions: [{ source: 'workspace', content: 'claude words' }],
  });
  writeFileSync(path.join(workspace, 'AGENTS.md'), 'agents words');
  mkdirSync(path.join(home, '.agents'));
  writeFileSync(path.join(home, '.agents', 'AGENTS.md'), 'user words');
  assert.deepEqual(service.instructions(workspace).instructions, [
    { source: 'user', content: 'user words' },
    { source: 'workspace', content: 'agents words' },
  ]);
  writeFileSync(path.join(workspace, 'AGENTS.md'), 'a'.repeat(CAP + 1));
  assert.throws(() => service.instructions(workspace), code('SKILL_FILE_TOO_LARGE'));
  writeFileSync(path.join(home, '.agents', 'AGENTS.md'), 'a'.repeat(CAP + 1));
  assert.throws(() => service.instructions(null), code('SKILL_FILE_TOO_LARGE'));
});

test('writeInstructions creates the user folder and rejects unsafe bases', (t) => {
  const { root, home, workspace, service } = setup(t);
  assert.throws(() => service.writeInstructions('workspace', null, 'x'), /No workspace is active/);
  assert.throws(
    () => service.writeInstructions('user', null, 'a'.repeat(CAP + 1)),
    code('SKILL_FILE_TOO_LARGE'),
  );
  assert.deepEqual(service.writeInstructions('user', null, 'user words'), {
    source: 'user',
    file: 'AGENTS.md',
    sizeBytes: 10,
  });
  assert.equal(readFileSync(path.join(home, '.agents', 'AGENTS.md'), 'utf8'), 'user words');
  assert.equal(service.writeInstructions('workspace', workspace, 'ws words').file, 'AGENTS.md');
  const fileBase = path.join(root, 'plain-file');
  writeFileSync(fileBase, 'file');
  assert.throws(
    () => service.writeInstructions('workspace', fileBase, 'x'),
    /Instruction directory is not safe/,
  );
});
