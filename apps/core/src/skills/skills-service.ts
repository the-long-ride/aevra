import os from 'node:os';
import path from 'node:path';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
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
  sensitivity: 'SECRET' | 'NORMAL';
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
  private readBounded(file: string): string {
    if (statSync(file).size > FILE_CAP_BYTES)
      throw new AevraToolError('SKILL_FILE_TOO_LARGE', `File exceeds ${FILE_CAP_BYTES} bytes`);
    return readFileSync(file, 'utf8');
  }
}
