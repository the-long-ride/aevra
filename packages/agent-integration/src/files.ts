import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const entryHash = (value: unknown): string => hash(JSON.stringify(value));

export function readText(file: string): string | null {
  try {
    if (lstatSync(file).isSymbolicLink())
      throw new Error(`AGENT_PATH_CONFLICT: refusing symbolic file ${file}`);
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function writeAtomic(file: string, content: string, expected: string | null): void {
  if (readText(file) !== expected) throw new Error(`AGENT_CONCURRENT_EDIT: ${file}`);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    if (readText(file) !== expected) throw new Error(`AGENT_CONCURRENT_EDIT: ${file}`);
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export interface WrittenFile {
  file: string;
  before: string | null;
  after: string;
}
export function rollbackFiles(writes: WrittenFile[]): void {
  for (const item of [...writes].reverse()) {
    if (readText(item.file) !== item.after) continue;
    if (item.before === null) unlinkSync(item.file);
    else writeAtomic(item.file, item.before, item.after);
  }
}
