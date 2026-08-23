import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { resolveCapabilityPath } from '../../security/src/path-policy.js';
import { runCommand } from './commands.js';
import { fileRead } from './files.js';

// Pure-JS scan bounds keep the last-resort backend bounded like the native ones.
const NODE_SCAN_FILE_LIMIT = 2_000;
const NODE_SCAN_MAX_FILE_BYTES = 512 * 1024;

type SearchOperation = Extract<WorkerOperation, { kind: 'search.multi' }>;
type SearchQuery = SearchOperation['queries'][number];
type Candidate = { path: string; line?: number };

function commandInput(executable: string, args: string[], env: Record<string, string> = {}) {
  return { executable, args, env, timeoutMs: 30_000 };
}

function parseRgJson(stdout: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as any;
      if (event.type !== 'match') continue;
      const file = event.data?.path?.text;
      const lineNumber = event.data?.line_number;
      if (typeof file === 'string' && typeof lineNumber === 'number') {
        candidates.push({ path: file, line: lineNumber });
      }
    } catch {
      // Ignore malformed native output rather than exposing it remotely.
    }
  }
  return candidates;
}

function unique(candidates: Candidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.path}\u0000${candidate.line ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function ripgrep(query: SearchQuery, cwd: string) {
  if (query.mode === 'files') {
    const result = await runCommand(
      commandInput('rg', ['--files', '--hidden', '--glob', '!.git/**']),
      cwd,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || `rg exited ${result.exitCode}`);
    return {
      backend: 'rg',
      candidates: result.stdout
        .split(/\r?\n/)
        .filter((file) => file && file.includes(query.value))
        .map((file) => ({ path: file })),
    };
  }
  const args = ['--json', '--line-number', '--hidden', '--glob', '!.git/**'];
  if (query.mode === 'text') args.push('--fixed-strings');
  args.push('--', query.value, '.');
  const result = await runCommand(commandInput('rg', args), cwd);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(result.stderr || `rg exited ${result.exitCode}`);
  }
  return { backend: 'rg', candidates: parseRgJson(result.stdout) };
}

async function powershell(query: SearchQuery, cwd: string) {
  // Joined with newlines so `else` stays attached to its `if` block; a `; `
  // separator terminates the if statement and leaves a bare `else`.
  //
  // The search value is embedded in the script instead of an environment
  // variable because runCommand treats every env value as a secret and would
  // redact it out of the very matches this backend returns.
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const scriptLines = [
    "$ErrorActionPreference='Stop'",
    "$files=Get-ChildItem -LiteralPath . -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '[\\\\/]\\.git([\\\\/]|$)' }",
  ];
  if (query.mode === 'files') {
    scriptLines.push('$files | ForEach-Object { $_.FullName }');
  } else {
    scriptLines.push(
      `$value=${literal(query.value)}`,
      `$simple=${query.mode === 'text' ? '$true' : '$false'}`,
      'foreach ($file in $files) {',
      '  if ($simple) { $matches=Select-String -LiteralPath $file.FullName -Pattern $value -SimpleMatch -ErrorAction SilentlyContinue }',
      '  else { $matches=Select-String -LiteralPath $file.FullName -Pattern $value -ErrorAction SilentlyContinue }',
      '  foreach ($match in $matches) { Write-Output ($match.Path + "`t" + $match.LineNumber) }',
      '}',
    );
  }
  const script = scriptLines.join('\n');
  // EncodedCommand avoids command-line quoting and injection issues entirely.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded];
  let lastError: unknown;
  for (const executable of ['powershell.exe', 'pwsh']) {
    let result;
    try {
      result = await runCommand(commandInput(executable, args), cwd);
    } catch (error) {
      lastError = error;
      continue;
    }
    if (result.exitCode === 0) {
      return interpretPowerShellOutput(result.stdout, query);
    }
    lastError = new Error(
      result.stderr ||
        `PowerShell exited ${result.exitCode}${result.signal ? ` via ${result.signal}` : ''}`,
    );
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function interpretPowerShellOutput(stdout: string, query: SearchQuery) {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const candidates =
    query.mode === 'files'
      ? lines.filter((file) => file.includes(query.value)).map((file) => ({ path: file }))
      : lines.map((line) => {
          const [file, lineNumber] = line.split('\t');
          return { path: file ?? '', line: Number(lineNumber) || undefined };
        });
  return { backend: 'powershell', candidates };
}

async function grep(query: SearchQuery, cwd: string) {
  if (query.mode === 'files') {
    const result = await runCommand(
      commandInput('find', ['.', '-path', './.git', '-prune', '-o', '-type', 'f', '-print']),
      cwd,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || `find exited ${result.exitCode}`);
    return {
      backend: 'find',
      candidates: result.stdout
        .split(/\r?\n/)
        .filter((file) => file && file.includes(query.value))
        .map((file) => ({ path: file })),
    };
  }
  const args = ['-RInI', query.mode === 'text' ? '-F' : '-E', '--', query.value, '.'];
  const result = await runCommand(commandInput('grep', args), cwd);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(result.stderr || `grep exited ${result.exitCode}`);
  }
  const candidates = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*):(\d+):/);
      return match ? { path: match[1]!, line: Number(match[2]) } : { path: '' };
    })
    .filter((candidate) => candidate.path);
  return { backend: 'grep', candidates };
}

// Last-resort backend used when no native search tool is usable. It only
// produces candidate paths and line numbers; every candidate still passes
// through safeHit, so capability and sensitivity policy stay enforced.
export async function nodeCandidates(query: SearchQuery, cwd: string) {
  const files: string[] = [];
  async function walk(dir: string) {
    if (files.length >= NODE_SCAN_FILE_LIMIT) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= NODE_SCAN_FILE_LIMIT) return;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        await walk(child);
      } else if (entry.isFile()) {
        files.push(child);
      }
    }
  }
  await walk(cwd);

  if (query.mode === 'files') {
    return {
      backend: 'node',
      candidates: files
        .filter((file) => file.includes(query.value))
        .map((file) => ({ path: file })),
    };
  }

  let matcher: (line: string) => boolean;
  if (query.mode === 'regex') {
    let pattern: RegExp;
    try {
      pattern = new RegExp(query.value);
    } catch {
      return { backend: 'node', candidates: [] };
    }
    matcher = (line) => pattern.test(line);
  } else {
    matcher = (line) => line.includes(query.value);
  }

  const candidates: Candidate[] = [];
  for (const file of files) {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (matcher(lines[index]!)) {
        candidates.push({ path: file, line: index + 1 });
        break;
      }
    }
    if (candidates.length >= NODE_SCAN_FILE_LIMIT) break;
  }
  return { backend: 'node', candidates };
}

async function platformNative(query: SearchQuery, cwd: string) {
  return process.platform === 'win32' ? powershell(query, cwd) : grep(query, cwd);
}

async function nativeCandidates(query: SearchQuery, cwd: string) {
  try {
    return await ripgrep(query, cwd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  try {
    return await platformNative(query, cwd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return nodeCandidates(query, cwd);
    // A present-but-failing native tool still leaves the bounded JS scan as a
    // usable last resort instead of surfacing "backend unavailable".
    return nodeCandidates(query, cwd);
  }
}

function logicalCandidate(baseLogical: string, baseHost: string, candidate: string) {
  const relative = path.isAbsolute(candidate) ? path.relative(baseHost, candidate) : candidate;
  const clean = relative.replaceAll('\\', '/').replace(/^\.\//, '');
  const prefix = baseLogical.replace(/\/$/, '');
  return `${prefix === '/' ? '' : prefix}/${clean}`.replace(/\/+/g, '/') || '/';
}

async function safeHit(
  candidate: Candidate,
  query: SearchQuery,
  base: { logicalPath: string; canonicalHostPath: string },
  roots: CapabilityRoot[],
) {
  if (!candidate.path) return null;
  const logicalPath = logicalCandidate(base.logicalPath, base.canonicalHostPath, candidate.path);
  try {
    if (query.mode === 'files') {
      await fileRead(logicalPath, roots, { offset: 0, length: 0 });
      return { path: logicalPath };
    }
    if (!candidate.line) return null;
    const read = await fileRead(logicalPath, roots);
    const text = String(read.content ?? '').split(/\r?\n/)[candidate.line - 1] ?? '';
    return { path: logicalPath, line: candidate.line, text: text.slice(0, 400) };
  } catch {
    return null;
  }
}

async function oneSearch(query: SearchQuery, roots: CapabilityRoot[], max: number) {
  const base = await resolveCapabilityPath(query.path || '/', roots, 'read');
  try {
    const native = await nativeCandidates(query, base.canonicalHostPath);
    const hits: Array<Record<string, unknown>> = [];
    for (const candidate of unique(native.candidates)) {
      const hit = await safeHit(candidate, query, base, roots);
      if (hit) hits.push(hit);
      if (hits.length >= max) break;
    }
    return {
      value: query.value,
      mode: query.mode,
      path: query.path,
      backend: native.backend,
      hits,
    };
  } catch (error) {
    return {
      value: query.value,
      mode: query.mode,
      path: query.path,
      backend: 'unavailable',
      hits: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function nativeMultiSearch(
  queries: SearchOperation['queries'],
  roots: CapabilityRoot[],
  maxResultsPerQuery = 50,
) {
  const max = Math.max(1, Math.min(200, maxResultsPerQuery));
  return { results: await Promise.all(queries.map((query) => oneSearch(query, roots, max))) };
}
