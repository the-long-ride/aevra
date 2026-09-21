import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  AnalysisContext,
  AnalysisServices,
  CapabilityRoot,
  ScopeStatus,
} from '../../protocol/src/command-analysis.js';
import { resolveExecutableIdentity } from '../../command-analysis/src/executable-resolver.js';
import { buildChildEnvironment } from '../../security/src/environment.js';

type HostPlatform = 'win32' | 'linux' | 'darwin';

function pathApi(platform: HostPlatform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function isContained(rootDir: string, candidateDir: string, platform: HostPlatform): boolean {
  const api = pathApi(platform);
  const fold = (value: string) => (platform === 'win32' ? value.toLowerCase() : value);
  const normRoot = fold(api.resolve(rootDir));
  const normCandidate = fold(api.resolve(candidateDir));
  const rel = api.relative(normRoot, normCandidate);
  return rel === '' || (!rel.startsWith(`..${api.sep}`) && rel !== '..' && !api.isAbsolute(rel));
}

function resolveLogicalCwd(cwd: string, roots: CapabilityRoot[], platform: HostPlatform): string {
  const api = pathApi(platform);
  const norm = ('/' + cwd.replaceAll('\\', '/')).replace(/\/+/g, '/');
  const sorted = [...roots].sort((a, b) => b.logicalPrefix.length - a.logicalPrefix.length);
  for (const root of sorted) {
    const prefix = root.logicalPrefix;
    if (norm === prefix || norm.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
      const rel = norm.slice(prefix.length).replace(/^\//, '');
      return api.resolve(root.hostRoot, ...rel.split('/').filter(Boolean));
    }
  }
  return cwd;
}

async function canonicalizeCandidate(
  candidate: string,
  roots: CapabilityRoot[],
  platform: HostPlatform,
): Promise<{ canonicalPath: string; scope: ScopeStatus; reasons: any[] }> {
  const api = pathApi(platform);
  const canonicalRoots: Array<{ root: CapabilityRoot; canonical: string }> = [];
  for (const root of roots) {
    try {
      canonicalRoots.push({ root, canonical: await realpath(root.hostRoot) });
    } catch {
      return {
        canonicalPath: candidate,
        scope: 'unknown',
        reasons: [
          {
            code: 'DYNAMIC_SCOPE',
            message: `Authorized workspace root cannot be canonicalized: ${root.hostRoot}`,
          },
        ],
      };
    }
  }

  let probe = candidate;
  let canonicalProbe: string | null = null;
  while (true) {
    try {
      canonicalProbe = await realpath(probe);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return {
          canonicalPath: candidate,
          scope: 'unknown',
          reasons: [
            {
              code: 'DYNAMIC_SCOPE',
              message: `Target path cannot be canonicalized safely: ${candidate}`,
            },
          ],
        };
      }
      const parent = api.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }

  if (!canonicalProbe) {
    return {
      canonicalPath: candidate,
      scope: 'unknown',
      reasons: [
        {
          code: 'DYNAMIC_SCOPE',
          message: `Target path cannot be canonicalized safely: ${candidate}`,
        },
      ],
    };
  }

  const canonicalRoot = canonicalRoots.find(({ canonical }) =>
    isContained(canonical, canonicalProbe!, platform),
  );
  if (!canonicalRoot) {
    return {
      canonicalPath: canonicalProbe,
      scope: 'outside',
      reasons: [
        {
          code: 'OUTSIDE_WORKSPACE',
          message: `Target resolves outside authorized workspace: ${candidate}`,
        },
      ],
    };
  }

  let canonicalPath = canonicalProbe;
  if (probe !== candidate) {
    canonicalPath = api.resolve(canonicalProbe, api.relative(probe, candidate));
  }
  if (!isContained(canonicalRoot.canonical, canonicalPath, platform)) {
    return {
      canonicalPath,
      scope: 'outside',
      reasons: [
        {
          code: 'OUTSIDE_WORKSPACE',
          message: `Target resolves outside authorized workspace: ${candidate}`,
        },
      ],
    };
  }

  return { canonicalPath, scope: 'inside', reasons: [] };
}

export function createAnalysisServices(
  workspaceRoot?: string,
  roots: CapabilityRoot[] = [],
  platform: HostPlatform = process.platform as HostPlatform,
  requestEnv: Record<string, string> = {},
): AnalysisServices {
  const api = pathApi(platform);
  const commandRoots = roots.filter((root) => root.capabilities?.includes('commands.run'));
  const childEnv = buildChildEnvironment(requestEnv, process.env, platform);

  return {
    async resolveExecutable(name: string, cwd: string, context: AnalysisContext) {
      if (context.backendId !== 'host') return null;
      const hostCwd = resolveLogicalCwd(cwd, commandRoots, platform);
      return resolveExecutableIdentity(name, hostCwd, {
        env: childEnv,
        platform,
        backendId: context.backendId,
        workspaceRoots: commandRoots.map((root) => root.hostRoot),
        resolverGeneration: context.resolverGeneration,
      });
    },

    async canonicalizeCwd(cwd: string) {
      if (roots.length === 0) {
        return { canonicalPath: cwd, scope: 'unknown' as ScopeStatus, reasons: [] };
      }
      if (commandRoots.length === 0) {
        return {
          canonicalPath: cwd,
          scope: 'outside' as ScopeStatus,
          reasons: [
            { code: 'OUTSIDE_WORKSPACE', message: 'No capability root grants commands.run' },
          ],
        };
      }
      const hostCwd = resolveLogicalCwd(cwd, commandRoots, platform);
      return canonicalizeCandidate(hostCwd, commandRoots, platform);
    },

    async canonicalize(targetPath: string, cwd: string) {
      if (roots.length === 0) {
        return { canonicalPath: targetPath, scope: 'unknown' as ScopeStatus, reasons: [] };
      }
      if (commandRoots.length === 0) {
        return {
          canonicalPath: targetPath,
          scope: 'outside' as ScopeStatus,
          reasons: [
            { code: 'OUTSIDE_WORKSPACE', message: 'No capability root grants commands.run' },
          ],
        };
      }

      const hostCandidate = api.isAbsolute(targetPath)
        ? api.resolve(targetPath)
        : api.resolve(resolveLogicalCwd(cwd, commandRoots, platform), targetPath);
      return canonicalizeCandidate(hostCandidate, commandRoots, platform);
    },

    async readConfig(configPath: string, maxBytes: number) {
      if (maxBytes < 0) return null;
      const readRoots = Array.from(
        new Set([
          ...commandRoots.map((root) => root.hostRoot),
          ...(workspaceRoot ? [workspaceRoot] : []),
        ]),
      );
      if (readRoots.length === 0) return null;

      const filePath = api.isAbsolute(configPath)
        ? api.resolve(configPath)
        : workspaceRoot
          ? api.resolve(workspaceRoot, configPath)
          : null;
      if (!filePath) return null;

      let handle: Awaited<ReturnType<typeof open>> | null = null;
      try {
        const canonicalFile = await realpath(filePath);
        const canonicalRoots = await Promise.all(readRoots.map((root) => realpath(root)));
        if (!canonicalRoots.some((root) => isContained(root, canonicalFile, platform))) return null;

        handle = await open(canonicalFile, 'r');
        const buffer = Buffer.alloc(Math.max(1, maxBytes + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > maxBytes) return null;
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        const fingerprint = createHash('sha256').update(text).digest('hex');
        return { text, fingerprint };
      } catch {
        return null;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
  };
}
