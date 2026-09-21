import { createHash } from 'node:crypto';
import { existsSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { ExecutableIdentity } from '../../protocol/src/command-analysis.js';

export interface ResolveOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  workspaceRoots?: string[];
  backendId?: string;
  resolverGeneration?: string;
}

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function normalizeEnvKeys(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const result: Record<string, string> = {};
  const seenOriginalKeys = new Map<string, string>();

  for (const [key, val] of Object.entries(env)) {
    if (val === undefined) continue;
    const lookupKey = platform === 'win32' ? key.toUpperCase() : key;
    if (platform === 'win32' && seenOriginalKeys.has(lookupKey)) {
      const prevKey = seenOriginalKeys.get(lookupKey)!;
      if (prevKey !== key && env[prevKey] !== val) {
        throw new Error(`Conflicting environment variable casing for ${key} and ${prevKey}`);
      }
    }
    seenOriginalKeys.set(lookupKey, key);
    result[lookupKey] = val;
  }
  return result;
}

function computeFileFingerprint(filePath: string): string {
  try {
    const stat = statSync(filePath);
    return createHash('sha256')
      .update(`${filePath}:${stat.size}:${stat.mtimeMs}`)
      .digest('hex')
      .slice(0, 16);
  } catch {
    return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
  }
}

function isInsideAny(targetPath: string, rootDirs: string[], platform: NodeJS.Platform): boolean {
  const api = pathApi(platform);
  const fold = (value: string) => (platform === 'win32' ? value.toLowerCase() : value);
  const normalizedTarget = fold(api.resolve(targetPath));
  for (const root of rootDirs) {
    let canonicalRoot = root;
    try {
      canonicalRoot = realpathSync(root);
    } catch {
      // Keep the lexical root when it does not exist in this resolver namespace.
    }
    const normalizedRoot = fold(api.resolve(canonicalRoot));
    const rel = api.relative(normalizedRoot, normalizedTarget);
    if (rel === '' || (!rel.startsWith(`..${api.sep}`) && rel !== '..' && !api.isAbsolute(rel))) {
      return true;
    }
  }
  return false;
}

export function resolveExecutablePath(
  executable: string,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd?: string,
): string | null {
  const api = pathApi(platform);
  const hasSeparator =
    platform === 'win32'
      ? executable.includes('/') || executable.includes('\\')
      : executable.includes('/');
  if (hasSeparator) {
    const resolved = cwd ? api.resolve(cwd, executable) : api.resolve(executable);
    return existsSync(resolved) ? resolved : null;
  }

  const normEnv = normalizeEnvKeys(env, platform);
  const pathVal = normEnv.PATH ?? '';
  const pathextVal = normEnv.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  const hasExt = Boolean(api.extname(executable));
  const extensions =
    platform === 'win32' ? (hasExt ? [''] : pathextVal.split(';').filter(Boolean)) : [''];
  const delimiter = platform === 'win32' ? ';' : ':';

  const searchDirs = pathVal.split(delimiter).filter(Boolean);
  for (const dir of searchDirs) {
    for (const ext of extensions) {
      const candidate = api.join(
        dir,
        platform === 'win32' && ext ? `${executable}${ext}` : executable,
      );
      if (existsSync(candidate)) {
        try {
          const stat = statSync(candidate);
          if (stat.isFile()) return candidate;
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}

export async function resolveExecutableIdentity(
  logicalName: string,
  cwd: string,
  options: ResolveOptions = {},
): Promise<ExecutableIdentity | null> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? (process.env as Record<string, string>);
  const backendId = options.backendId ?? 'host';
  const workspaceRoots = options.workspaceRoots ?? [];
  const api = pathApi(platform);

  const foundPath = resolveExecutablePath(logicalName, env, platform, cwd);
  if (!foundPath) return null;

  let canonical = foundPath;
  try {
    canonical = realpathSync(foundPath);
  } catch {
    canonical = api.resolve(foundPath);
  }

  const ext = api.extname(canonical).toLowerCase();
  let launcher: 'native' | 'cmd-shim' | 'script' = 'native';
  if (platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    launcher = 'cmd-shim';
  } else if (ext === '.sh' || ext === '.bash' || ext === '.ps1') {
    launcher = 'script';
  }

  let provenance: 'operator' | 'installed' | 'workspace' | 'unknown' = 'unknown';
  if (workspaceRoots.length > 0 && isInsideAny(canonical, workspaceRoots, platform)) {
    provenance = 'workspace';
  } else {
    const pLower = canonical.toLowerCase();
    const isSystem =
      pLower.includes('program files') ||
      pLower.includes('system32') ||
      pLower.includes('/usr/') ||
      pLower.includes('/bin/') ||
      pLower.includes('/opt/') ||
      pLower.includes('.cargo') ||
      pLower.includes('appdata\\roaming\\npm') ||
      pLower.includes('.nvm');
    provenance = isSystem ? 'installed' : 'operator';
  }

  const fingerprint = computeFileFingerprint(canonical);

  return {
    logicalName,
    canonicalPath: canonical,
    launcher,
    fingerprint,
    provenance,
    backendId,
  };
}
