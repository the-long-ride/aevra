import path from 'node:path';
import { ANALYSIS_BOUNDS } from './types.js';
import type { CommandNode, ParseShellResult, Reason } from './types.js';

function resolveLogicalPath(baseLogical: string, relativeOrAbsolute: string): string {
  const norm = relativeOrAbsolute.replaceAll('\\', '/');
  if (/^[a-zA-Z]:\//.test(norm) || norm.startsWith('/')) {
    return path.posix.normalize(norm);
  }
  return path.posix.normalize(path.posix.join(baseLogical.replaceAll('\\', '/'), norm));
}

function boundCandidates(
  candidates: Iterable<string>,
  node: CommandNode,
  reasons: Reason[],
): Set<string> {
  const values = Array.from(new Set(candidates));
  if (values.length <= ANALYSIS_BOUNDS.MAX_CWD_ALTERNATIVES) return new Set(values);

  if (!node.reasons.some((reason) => reason.code === 'ANALYSIS_LIMIT')) {
    const reason: Reason = {
      code: 'ANALYSIS_LIMIT',
      nodeId: node.id,
      message: `Working-directory alternatives exceed ${ANALYSIS_BOUNDS.MAX_CWD_ALTERNATIVES} candidate budget`,
    };
    node.reasons.push(reason);
    reasons.push(reason);
  }
  return new Set(values.slice(0, ANALYSIS_BOUNDS.MAX_CWD_ALTERNATIVES));
}

export function propagateCwdFlow(
  initialCwdLogical: string,
  nodes: CommandNode[],
  edges: ParseShellResult['edges'],
): Reason[] {
  const root =
    initialCwdLogical.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(initialCwdLogical)
      ? initialCwdLogical.replaceAll('\\', '/')
      : `/${initialCwdLogical.replaceAll('\\', '/')}`;

  let activeCandidates = new Set<string>([root]);
  const dirStack: string[] = [];
  const reasons: Reason[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    if (node.cwdCandidates.length === 0) {
      node.cwdCandidates = Array.from(activeCandidates);
    }

    if (node.application === 'builtin:cd' || node.application === 'builtin:pushd') {
      const cdTarget = node.operation[1];
      if (cdTarget) {
        if (cdTarget.startsWith('$') || cdTarget.startsWith('%')) {
          node.reasons.push({
            code: 'DYNAMIC_SCOPE',
            message: `Dynamic cwd transition detected: ${cdTarget}`,
          });
        } else {
          let nextCandidates = new Set<string>();
          for (const cand of activeCandidates) {
            nextCandidates.add(resolveLogicalPath(cand, cdTarget));
          }
          nextCandidates = boundCandidates(nextCandidates, node, reasons);

          if (node.application === 'builtin:pushd') {
            for (const cand of activeCandidates) {
              if (dirStack.length >= ANALYSIS_BOUNDS.MAX_CWD_ALTERNATIVES) {
                const reason: Reason = {
                  code: 'ANALYSIS_LIMIT',
                  nodeId: node.id,
                  message: `Directory stack exceeds ${ANALYSIS_BOUNDS.MAX_CWD_ALTERNATIVES} entry budget`,
                };
                node.reasons.push(reason);
                reasons.push(reason);
                break;
              }
              dirStack.push(cand);
            }
          }

          node.cwdCandidates = Array.from(nextCandidates);

          const outgoing = edges.filter((e) => e.from === node.id);
          const hasSequence = outgoing.some((e) => e.kind === 'sequence');
          const isPipe = outgoing.some((e) => e.kind === 'pipe');
          const isSubshell = outgoing.some((e) => e.kind === 'subshell');

          if (isPipe || isSubshell) {
            // Pipeline and subshell boundaries do not leak cwd to parent/siblings.
          } else if (hasSequence) {
            activeCandidates = boundCandidates(
              [...nextCandidates, ...activeCandidates],
              node,
              reasons,
            );
          } else {
            activeCandidates = nextCandidates;
          }
        }
      }
    } else if (node.application === 'builtin:popd') {
      if (dirStack.length > 0) {
        const popped = dirStack.pop()!;
        activeCandidates = new Set([popped]);
        node.cwdCandidates = [popped];
      }
    }
  }

  return reasons;
}
