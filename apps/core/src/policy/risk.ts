import type { RiskTier } from '../../../../packages/protocol/src/index.js';

/** A delete or overwrite aimed at a filesystem root, home, or drive letter. */
const ROOT_TARGET = /(^|\s)(\/|~|\/\*|\$home|%userprofile%|c:\\?)(\s|$)/;
/** Recursive-and-forced deletion in either flag order, plus the PowerShell form. */
const RECURSIVE_DELETE = /\brm\b.*(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b|remove-item.*-recurse/;
/** Fetch piped straight into an interpreter. */
const DOWNLOAD_PIPE = /(curl|wget|invoke-webrequest|iwr).*\|\s*(ba|z|)sh\b|iex\s*\(/;

/**
 * Maps an operation family and its arguments to a risk tier.
 *
 * The original implementation matched only abstract tokens such as
 * `recursive-delete`, which never appear in real argv, so genuinely destructive
 * commands like `rm -rf /` classified LOW. Those tokens are preserved below so
 * existing callers keep their behavior; the added patterns match what real
 * command lines actually look like.
 */
export function classifyOperationRisk(family: string, args: string[] = []): RiskTier {
  const joined = `${family} ${args.join(' ')}`.toLowerCase();

  if (/privilege|sudo|runas|doas|system-directory|security-db|workspace-escape/.test(joined))
    return 'CRITICAL';
  if (
    /\bmkfs(\.|\b)|\bdiskpart\b|\bformat:|\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/.test(
      joined,
    )
  )
    return 'CRITICAL';
  if (/\bdd\b/.test(joined) && /of=\/dev\//.test(joined)) return 'CRITICAL';
  if (RECURSIVE_DELETE.test(joined) && ROOT_TARGET.test(joined)) return 'CRITICAL';

  if (
    /push.*--force|reset.*--hard|git:clean|recursive-delete|history-rewrite|download.*execute/.test(
      joined,
    )
  )
    return 'HIGH';
  if (RECURSIVE_DELETE.test(joined)) return 'HIGH';
  if (/\b(chmod|chown)\b.*(-r\b|--recursive)/.test(joined)) return 'HIGH';
  if (/npm:publish|\bnpm\b.*\bpublish\b/.test(joined)) return 'HIGH';
  if (DOWNLOAD_PIPE.test(joined)) return 'HIGH';

  if (/git:push|git:commit|package:install|host-fallback|files:delete|network:unknown/.test(joined))
    return 'MEDIUM';
  return 'LOW';
}
