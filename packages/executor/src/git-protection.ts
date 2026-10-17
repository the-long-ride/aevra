import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ProtectedGlob } from '../../protocol/src/worker.js';
import type { CapabilityRoot } from '../../protocol/src/index.js';
import { compileProtectedGlobs } from './protected-globs.js';
import { effectiveSensitivity } from './file-sensitivity.js';
import { runGit } from './git-runtime.js';

export async function gitFileExclusions(cwd: string, globs?: ProtectedGlob[]) {
  const listed = await runGit(
    cwd,
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    true,
  );
  if (listed.exitCode !== 0)
    throw Object.assign(new Error('Cannot inspect Git file protection'), {
      code: 'SECURITY_VIOLATION',
    });
  const roots: CapabilityRoot[] = [
    {
      id: 'repository',
      kind: 'workspace',
      logicalPrefix: '/',
      hostRoot: cwd,
      capabilities: ['files.read'],
    },
  ];
  const userPatterns = compileProtectedGlobs(globs);
  const hidden: string[] = [];
  for (const name of new Set(listed.stdout.split('\0').filter(Boolean))) {
    const host = path.join(cwd, name);
    let canonical = host,
      info;
    try {
      canonical = await realpath(host);
      info = await stat(canonical);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const sensitivity = await effectiveSensitivity(
      '/' + name,
      canonical,
      roots,
      info,
      undefined,
      userPatterns,
    );
    if (sensitivity !== 'NORMAL') hidden.push(`:(exclude,literal)${name}`);
  }
  return hidden;
}

export async function gitPathSensitivity(cwd: string, name: string, globs?: ProtectedGlob[]) {
  const roots: CapabilityRoot[] = [
    {
      id: 'repository',
      kind: 'workspace',
      logicalPrefix: '/',
      hostRoot: cwd,
      capabilities: ['files.read'],
    },
  ];
  const host = path.join(cwd, name);
  let canonical = host,
    info;
  try {
    canonical = await realpath(host);
    info = await stat(canonical);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return effectiveSensitivity(
    '/' + name,
    canonical,
    roots,
    info,
    undefined,
    compileProtectedGlobs(globs),
  );
}
