import path from 'node:path';
import type {
  AnalysisContext,
  AnalysisServices,
  CommandNode,
  Reason,
  ScopeStatus,
} from './types.js';

function isPathContained(rootDir: string, candidateDir: string, isWin = false): boolean {
  const normRoot = isWin ? path.resolve(rootDir).toLowerCase() : path.resolve(rootDir);
  const normCandidate = isWin
    ? path.resolve(candidateDir).toLowerCase()
    : path.resolve(candidateDir);
  const rel = path.relative(normRoot, normCandidate);
  if (rel === '') return true;
  return !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}

function isLogicalContained(
  logicalPrefix: string,
  candidateLogical: string,
  isWin = false,
): boolean {
  const rawPrefix = ('/' + logicalPrefix.replaceAll('\\', '/')).replace(/\/+/g, '/');
  const rawCandidate = ('/' + candidateLogical.replaceAll('\\', '/')).replace(/\/+/g, '/');
  const normPrefix = isWin ? rawPrefix.toLowerCase() : rawPrefix;
  const normCandidate = isWin ? rawCandidate.toLowerCase() : rawCandidate;

  if (normPrefix === '/' || normPrefix === normCandidate) return true;
  return normCandidate.startsWith(normPrefix.endsWith('/') ? normPrefix : `${normPrefix}/`);
}

export interface ScopeEvaluationResult {
  scope: ScopeStatus;
  reasons: Reason[];
}

export async function evaluateScope(
  nodes: CommandNode[],
  roots: Array<{ id?: string; logicalPrefix: string; hostRoot?: string }>,
  services?: AnalysisServices,
  context?: AnalysisContext,
): Promise<ScopeEvaluationResult> {
  const reasons: Reason[] = [];
  let overallScope: ScopeStatus = 'inside';
  const isWin = context?.platform === 'win32';
  const canonicalizeFn = services?.canonicalize ?? (services as any)?.canonicalizeTarget;
  const canonicalizeCwdFn = services?.canonicalizeCwd;

  for (const node of nodes) {
    let nodeScope: ScopeStatus = 'inside';

    // Check cwd candidates
    for (const cwd of node.cwdCandidates) {
      if (cwd.startsWith('$') || cwd.startsWith('%')) {
        nodeScope = 'unknown';
        const r: Reason = {
          code: 'DYNAMIC_SCOPE',
          nodeId: node.id,
          message: `Dynamic working directory cannot be proven inside workspace: ${cwd}`,
        };
        node.reasons.push(r);
        reasons.push(r);
        continue;
      }

      if ((canonicalizeCwdFn || canonicalizeFn) && context) {
        const res = canonicalizeCwdFn
          ? await canonicalizeCwdFn.call(services, cwd, context)
          : await canonicalizeFn!.call(services, cwd, cwd, 'cwd', context);
        if (res.canonicalPath) {
          node.canonicalCwdCandidates ??= [];
          node.canonicalCwdCandidates.push(res.canonicalPath);
        }
        if (res.scope === 'outside') {
          nodeScope = 'outside';
          node.reasons.push(...res.reasons);
          reasons.push(...res.reasons);
          continue;
        }
        if (res.scope === 'unknown') {
          nodeScope = nodeScope === 'outside' ? 'outside' : 'unknown';
          node.reasons.push(...res.reasons);
          reasons.push(...res.reasons);
          continue;
        }
      }

      const insideLogical = roots.some((r) => isLogicalContained(r.logicalPrefix, cwd, isWin));
      let insideHost = false;
      if (path.isAbsolute(cwd)) {
        for (const root of roots) {
          if (root.hostRoot && isPathContained(root.hostRoot, cwd, isWin)) {
            insideHost = true;
            break;
          }
        }
      }

      if (!insideLogical && !insideHost) {
        nodeScope = 'outside';
        const r: Reason = {
          code: 'OUTSIDE_WORKSPACE',
          nodeId: node.id,
          message: `Working directory leaves authorized workspace roots: ${cwd}`,
        };
        node.reasons.push(r);
        reasons.push(r);
      }
    }

    // Check targets (files, redirects, -C paths, etc.)
    for (const target of node.targets) {
      if (target.path.startsWith('$') || target.path.startsWith('%')) {
        target.scope = 'unknown';
        nodeScope = nodeScope === 'outside' ? 'outside' : 'unknown';
        const r: Reason = {
          code: 'DYNAMIC_SCOPE',
          nodeId: node.id,
          message: `Dynamic target path: ${target.path}`,
        };
        node.reasons.push(r);
        reasons.push(r);
        continue;
      }

      if (canonicalizeFn && context) {
        const res = await canonicalizeFn.call(
          services,
          target.path,
          node.cwdCandidates[0] ?? '/',
          target.access,
          context,
        );
        target.scope = res.scope;
        if (res.canonicalPath) target.canonicalPath = res.canonicalPath;
        if (res.scope === 'outside') {
          nodeScope = 'outside';
          node.reasons.push(...res.reasons);
          reasons.push(...res.reasons);
          continue;
        }
        if (res.scope === 'unknown') {
          nodeScope = nodeScope === 'outside' ? 'outside' : 'unknown';
          node.reasons.push(...res.reasons);
          reasons.push(...res.reasons);
          continue;
        }
      }

      // Resolve relative or absolute target against node cwd
      const base = node.cwdCandidates[0] ?? '/';
      const normTarget = target.path.replaceAll('\\', '/');
      const resolved = path.posix.isAbsolute(normTarget)
        ? path.posix.normalize(normTarget)
        : path.posix.normalize(path.posix.join(base.replaceAll('\\', '/'), normTarget));

      const insideLogical = roots.some((r) => isLogicalContained(r.logicalPrefix, resolved, isWin));
      let insideHost = false;
      if (path.isAbsolute(target.path)) {
        for (const root of roots) {
          if (root.hostRoot && isPathContained(root.hostRoot, target.path, isWin)) {
            insideHost = true;
            break;
          }
        }
      }

      if (!insideLogical && !insideHost) {
        target.scope = 'outside';
        nodeScope = 'outside';
        const r: Reason = {
          code: 'OUTSIDE_WORKSPACE',
          nodeId: node.id,
          message: `Target path escapes workspace roots: ${target.path}`,
        };
        node.reasons.push(r);
        reasons.push(r);
        continue;
      }

      target.scope = 'inside';
    }

    node.scope = nodeScope;
    if (nodeScope === 'outside') {
      overallScope = 'outside';
    } else if (nodeScope === 'unknown' && overallScope !== 'outside') {
      overallScope = 'unknown';
    }
  }

  return { scope: overallScope, reasons };
}
