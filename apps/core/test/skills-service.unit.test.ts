import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SkillsService, parseFrontmatter } from '../src/skills/skills-service.js';
function tree() {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-skills-'));
  const home = path.join(base, 'home'),
    ws = path.join(base, 'ws');
  mkdirSync(path.join(home, '.agents', 'skills', 'alpha'), { recursive: true });
  writeFileSync(
    path.join(home, '.agents', 'skills', 'alpha', 'SKILL.md'),
    '---\nname: Alpha\ndescription: Does alpha things\n---\n# Alpha\nUse alpha.',
  );
  mkdirSync(path.join(home, '.agents', 'skills', 'beta'), { recursive: true });
  writeFileSync(path.join(home, '.agents', 'skills', 'beta', 'SKILL.md'), '# Beta no frontmatter');
  writeFileSync(path.join(home, '.agents', 'skills', 'beta', 'extra.md'), 'extra');
  mkdirSync(path.join(ws, '.agents', 'skills', 'alpha'), { recursive: true });
  writeFileSync(
    path.join(ws, '.agents', 'skills', 'alpha', 'SKILL.md'),
    '---\nname: Alpha\ndescription: Workspace alpha\n---\nworkspace alpha',
  );
  writeFileSync(path.join(ws, 'AGENTS.md'), 'workspace instructions');
  writeFileSync(path.join(home, '.agents', 'AGENTS.md'), 'global instructions');
  return { base, home, ws };
}
test('parseFrontmatter reads name and description, tolerates malformed', () => {
  assert.deepEqual(parseFrontmatter('---\nname: X\ndescription: Y\n---\nbody'), {
    name: 'X',
    description: 'Y',
  });
  assert.deepEqual(parseFrontmatter('no frontmatter'), {});
  assert.deepEqual(parseFrontmatter('---\nnever closed'), {});
});
test('list merges user and workspace skills with fallback names', () => {
  const { home, ws } = tree();
  const svc = new SkillsService(home);
  const names = svc.list(ws);
  assert.equal(names.filter((s) => s.name === 'Alpha').length, 2);
  assert.deepEqual(names.find((s) => s.source === 'user' && s.name === 'beta')!.description, '');
  assert.equal(
    names.find((s) => s.source === 'workspace' && s.name === 'Alpha')!.description,
    'Workspace alpha',
  );
  assert.equal(svc.list(null).filter((s) => s.source === 'workspace').length, 0);
});
test('read returns SKILL.md, supporting files list, and file content', () => {
  const { home, ws } = tree();
  const svc = new SkillsService(home);
  const main = svc.read('user', 'Alpha', ws);
  assert.match(main.content, /Use alpha/);
  assert.deepEqual(main.files, []);
  const beta = svc.read('user', 'beta', ws);
  assert.deepEqual(beta.files, ['extra.md']);
  const extra = svc.read('user', 'beta', ws, 'extra.md');
  assert.equal(extra.content, 'extra');
});
test('read blocks traversal and size caps', () => {
  const { home, ws, base } = tree();
  const svc = new SkillsService(home);
  writeFileSync(path.join(home, '.agents', 'escape.txt'), 'x'); // '../../escape.txt' from a skill dir resolves to .agents/
  assert.throws(
    () => svc.read('user', 'Alpha', ws, '../../escape.txt'),
    (e: any) => e.code === 'SKILL_PATH_ESCAPE',
  );
  writeFileSync(path.join(home, '.agents', 'skills', 'beta', 'big.md'), 'x'.repeat(256 * 1024 + 1));
  assert.throws(
    () => svc.read('user', 'beta', ws, 'big.md'),
    (e: any) => e.code === 'SKILL_FILE_TOO_LARGE',
  );
  assert.throws(
    () => svc.read('user', 'nope', ws),
    (e: any) => e.code === 'SKILL_NOT_FOUND',
  );
  assert.throws(
    () => svc.read('workspace', 'Alpha', null),
    (e: any) => e.code === 'SKILL_NOT_FOUND',
  );
});
test('instructions merge user global then workspace, with CLAUDE.md fallback', () => {
  const { home, ws, base } = tree();
  const svc = new SkillsService(home);
  const r = svc.instructions(ws);
  assert.deepEqual(
    r.instructions.map((x) => x.source),
    ['user', 'workspace'],
  );
  assert.match(r.instructions[1]!.content, /workspace instructions/);
  rmSync(path.join(ws, 'AGENTS.md'));
  writeFileSync(path.join(ws, 'CLAUDE.md'), 'claude fallback');
  assert.match(svc.instructions(ws).instructions[1]!.content, /claude fallback/);
  const bareHome = mkdtempSync(path.join(tmpdir(), 'aevra-skills-bare-'));
  const empty = new SkillsService(bareHome).instructions(path.join(base, 'empty-ws'));
  assert.deepEqual(empty.instructions, []);
  assert.ok(empty.note);
});
test('oversized instruction file throws SKILL_FILE_TOO_LARGE', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-instr-'));
  mkdirSync(path.join(home, '.agents'), { recursive: true });
  writeFileSync(path.join(home, '.agents', 'AGENTS.md'), 'x'.repeat(256 * 1024 + 1));
  const svc = new SkillsService(home);
  assert.throws(
    () => svc.instructions(null),
    (e: any) => e.code === 'SKILL_FILE_TOO_LARGE',
  );
});
