import os from 'node:os';
import path from 'node:path';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { AevraToolError } from '../../../../packages/mcp-tools/src/errors.js';
import {
  classifySensitivity,
  maskSecretFile,
} from '../../../../packages/security/src/sensitive.js';
const FRONTMATTER_PREVIEW_BYTES = 4096;
const FILE_CAP_BYTES = 256 * 1024;
export interface SkillSummary {
  name: string;
  source: 'user' | 'workspace';
  description: string;
}
export interface SkillReadResult {
  skill: SkillSummary;
  content: string;
  files: string[];
  sensitivity: 'SECRET' | 'SENSITIVE' | 'NORMAL';
}
export interface SkillWriteResult {
  source: 'user' | 'workspace';
  name: string;
  file: string;
  sizeBytes: number;
}
export interface InstructionEntry {
  source: 'user' | 'workspace';
  content: string;
}
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'name') out.name = m[2]!.trim();
    if (m[1] === 'description') out.description = m[2]!.trim();
  }
  return out;
}
interface ScannedSkill {
  dirName: string;
  dir: string;
  fm: { name?: string; description?: string };
}
export class SkillsService {
  constructor(private userHome: string = os.homedir()) {}
  private base(source: 'user' | 'workspace', workspaceRoot: string | null): string | null {
    if (source === 'user') return path.join(this.userHome, '.agents', 'skills');
    return workspaceRoot ? path.join(workspaceRoot, '.agents', 'skills') : null;
  }
  private skillPreview(file: string): string | null {
    let fd: number;
    try {
      fd = openSync(file, 'r');
    } catch {
      return null;
    }
    try {
      const buf = Buffer.alloc(FRONTMATTER_PREVIEW_BYTES);
      const n = readSync(fd, buf, 0, FRONTMATTER_PREVIEW_BYTES, 0);
      return buf.subarray(0, n).toString('utf8');
    } finally {
      closeSync(fd);
    }
  }
  private scanSkills(base: string): ScannedSkill[] {
    const out: ScannedSkill[] = [];
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(base, e.name);
      const preview = this.skillPreview(path.join(dir, 'SKILL.md'));
      if (preview === null) continue;
      out.push({ dirName: e.name, dir, fm: parseFrontmatter(preview) });
    }
    return out;
  }
  list(workspaceRoot: string | null): SkillSummary[] {
    const out: SkillSummary[] = [];
    for (const source of ['user', 'workspace'] as const) {
      const base = this.base(source, workspaceRoot);
      if (!base) continue;
      for (const s of this.scanSkills(base))
        out.push({
          name: s.fm.name?.trim() || s.dirName,
          source,
          description: s.fm.description ?? '',
        });
    }
    return out;
  }
  read(
    source: 'user' | 'workspace',
    name: string,
    workspaceRoot: string | null,
    file?: string,
  ): SkillReadResult {
    const base = this.base(source, workspaceRoot);
    if (!base) throw new AevraToolError('SKILL_NOT_FOUND', 'No workspace is active');
    const found = this.scanSkills(base).find((s) => (s.fm.name?.trim() || s.dirName) === name);
    if (!found) throw new AevraToolError('SKILL_NOT_FOUND', `Skill ${name} not found`);
    const target = file ? path.resolve(found.dir, file) : path.join(found.dir, 'SKILL.md');
    const realDir = realpathSync(found.dir);
    let realTarget: string;
    try {
      realTarget = realpathSync(target);
    } catch {
      throw new AevraToolError('SKILL_NOT_FOUND', 'File not found');
    }
    if (realTarget !== realDir && !realTarget.startsWith(realDir + path.sep))
      throw new AevraToolError('SKILL_PATH_ESCAPE', 'Resolved path escapes the skill directory');
    const stat = statSync(realTarget);
    if (stat.isDirectory()) throw new AevraToolError('SKILL_NOT_FOUND', 'Path is a directory');
    if (stat.size > FILE_CAP_BYTES)
      throw new AevraToolError('SKILL_FILE_TOO_LARGE', `File exceeds ${FILE_CAP_BYTES} bytes`);
    const raw = readFileSync(realTarget, 'utf8');
    const sensitivity = classifySensitivity({ path: realTarget });
    const content = sensitivity === 'SECRET' ? maskSecretFile(realTarget, raw) : raw;
    const files = readdirSync(realDir, { withFileTypes: true })
      .map((e) => e.name)
      .filter((f) => f !== 'SKILL.md');
    return {
      skill: { name, source, description: found.fm.description ?? '' },
      content,
      files,
      sensitivity,
    };
  }
  write(
    source: 'user' | 'workspace',
    name: string,
    workspaceRoot: string | null,
    file: string | undefined,
    content: string,
  ): SkillWriteResult {
    this.assertWriteSize(content);
    const base = this.base(source, workspaceRoot);
    if (!base) throw new AevraToolError('SKILL_NOT_FOUND', 'No workspace is active');
    const found = this.scanSkills(base).find((s) => (s.fm.name?.trim() || s.dirName) === name);
    if (!found) throw new AevraToolError('SKILL_NOT_FOUND', `Skill ${name} not found`);
    const relative = file?.trim() || 'SKILL.md';
    const target = this.safeWriteTarget(found.dir, relative);
    writeFileSync(target, content, { encoding: 'utf8', mode: 0o600 });
    return {
      source,
      name,
      file: relative.replaceAll('\\', '/'),
      sizeBytes: Buffer.byteLength(content),
    };
  }
  instructions(workspaceRoot: string | null): { instructions: InstructionEntry[]; note?: string } {
    const out: InstructionEntry[] = [];
    const globalPath = path.join(this.userHome, '.agents', 'AGENTS.md');
    if (existsSync(globalPath)) {
      try {
        out.push({ source: 'user', content: this.readBounded(globalPath) });
      } catch (e) {
        if (e instanceof AevraToolError) throw e;
      }
    }
    if (workspaceRoot) {
      const agents = path.join(workspaceRoot, 'AGENTS.md'),
        claude = path.join(workspaceRoot, 'CLAUDE.md');
      const chosen = existsSync(agents) ? agents : existsSync(claude) ? claude : null;
      if (chosen) {
        try {
          out.push({ source: 'workspace', content: this.readBounded(chosen) });
        } catch (e) {
          if (e instanceof AevraToolError) throw e;
        }
      }
    }
    return out.length
      ? { instructions: out }
      : { instructions: [], note: 'no instruction files found' };
  }
  writeInstructions(source: 'user' | 'workspace', workspaceRoot: string | null, content: string) {
    this.assertWriteSize(content);
    const base = source === 'user' ? path.join(this.userHome, '.agents') : workspaceRoot;
    if (!base) throw new AevraToolError('SKILL_NOT_FOUND', 'No workspace is active');
    this.ensureDirectory(base);
    const target = this.safeWriteTarget(base, 'AGENTS.md');
    writeFileSync(target, content, { encoding: 'utf8', mode: 0o600 });
    return { source, file: 'AGENTS.md', sizeBytes: Buffer.byteLength(content) };
  }
  private safeWriteTarget(baseDir: string, relative: string): string {
    if (!relative || path.isAbsolute(relative))
      throw new AevraToolError('SKILL_PATH_ESCAPE', 'Skill write path must be relative');
    const segments = relative.split(/[\\/]+/).filter(Boolean);
    if (!segments.length || segments.some((segment) => segment === '..' || segment === '.'))
      throw new AevraToolError('SKILL_PATH_ESCAPE', 'Skill write path escapes the skill directory');
    const realBase = realpathSync(baseDir);
    let parent = realBase;
    for (const segment of segments.slice(0, -1)) {
      const next = path.join(parent, segment);
      if (existsSync(next)) {
        const stat = lstatSync(next);
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new AevraToolError(
            'SKILL_PATH_ESCAPE',
            'Skill write parent is not a safe directory',
          );
        const real = realpathSync(next);
        if (real !== realBase && !real.startsWith(realBase + path.sep))
          throw new AevraToolError(
            'SKILL_PATH_ESCAPE',
            'Skill write path escapes the skill directory',
          );
        parent = real;
      } else {
        mkdirSync(next, { mode: 0o700 });
        parent = next;
      }
    }
    const target = path.join(parent, segments.at(-1)!);
    if (existsSync(target)) {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink() || stat.isDirectory())
        throw new AevraToolError('SKILL_PATH_ESCAPE', 'Skill write target is not a regular file');
      const real = realpathSync(target);
      if (real !== realBase && !real.startsWith(realBase + path.sep))
        throw new AevraToolError(
          'SKILL_PATH_ESCAPE',
          'Skill write path escapes the skill directory',
        );
    }
    return target;
  }
  private ensureDirectory(dir: string) {
    if (existsSync(dir)) {
      const stat = lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new AevraToolError('SKILL_PATH_ESCAPE', 'Instruction directory is not safe');
      return;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  private assertWriteSize(content: string) {
    if (Buffer.byteLength(content) > FILE_CAP_BYTES)
      throw new AevraToolError('SKILL_FILE_TOO_LARGE', `File exceeds ${FILE_CAP_BYTES} bytes`);
  }
  private readBounded(file: string): string {
    if (statSync(file).size > FILE_CAP_BYTES)
      throw new AevraToolError('SKILL_FILE_TOO_LARGE', `File exceeds ${FILE_CAP_BYTES} bytes`);
    return readFileSync(file, 'utf8');
  }
}
