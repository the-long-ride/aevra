import type { RiskTier } from '../../../../packages/protocol/src/index.js';
export function classifyOperationRisk(family: string, args: string[] = []): RiskTier {
  const joined = `${family} ${args.join(' ')}`.toLowerCase();
  if (/privilege|sudo|runas|system-directory|security-db|workspace-escape/.test(joined))
    return 'CRITICAL';
  if (
    /push.*--force|reset.*--hard|git:clean|recursive-delete|history-rewrite|download.*execute/.test(
      joined,
    )
  )
    return 'HIGH';
  if (/git:push|git:commit|package:install|host-fallback|files:delete|network:unknown/.test(joined))
    return 'MEDIUM';
  return 'LOW';
}
