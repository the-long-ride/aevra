import type {
  AnalysisContext,
  AnalysisServices,
  CommandAnalysis,
  CommandPolicyInput,
  ExecutableIdentity,
} from '../src/types.js';

export interface AnalysisFixtureOptions {
  platform?: 'win32' | 'linux' | 'darwin';
  root?: string;
  existingDirectories?: string[];
}

export function makeAnalysisFixture(opts: AnalysisFixtureOptions = {}) {
  const root = opts.root ?? '/work/repo';
  const platform = opts.platform ?? 'linux';
  const existingDirs = new Set(opts.existingDirectories ?? [root]);

  const context: AnalysisContext = {
    actor: 'test-actor',
    sessionId: 'ses_test',
    workspaceId: 'ws_test',
    rootsRevision: '1',
    platform,
    backendId: 'host',
    backendRevision: '1',
    policyRevision: '1',
    environmentFingerprint: 'env_fp',
    resolverGeneration: '1',
    workspaceRoot: root,
    roots: [{ id: 'root_1', logicalPrefix: root, hostRoot: root }],
  };

  const services: AnalysisServices = {
    async resolveExecutable(logicalName: string): Promise<ExecutableIdentity | null> {
      return {
        logicalName,
        canonicalPath: `/usr/bin/${logicalName}`,
        launcher: 'native',
        fingerprint: `fp_${logicalName}`,
        provenance: 'installed',
        backendId: 'host',
      };
    },
    async canonicalize(targetPath: string) {
      const normalized = targetPath.replaceAll('\\', '/');
      const normalizedRoot = root.replaceAll('\\', '/');
      const isInside =
        normalized === normalizedRoot ||
        normalized.startsWith(normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`);

      if (!isInside && targetPath.startsWith('/')) {
        return {
          canonicalPath: targetPath,
          scope: 'outside' as const,
          reasons: [
            {
              code: 'OUTSIDE_WORKSPACE',
              message: `Path leaves authorized workspace root: ${targetPath}`,
            },
          ],
        };
      }
      return { canonicalPath: targetPath, scope: 'inside' as const, reasons: [] };
    },
    async readConfig() {
      return null;
    },
  };

  return { context, services, existingDirs };
}

export function makePolicyFixture(analysis: CommandAnalysis): CommandPolicyInput {
  return {
    analysis,
    rules: [],
    authority: { valid: true, commandCapability: true, reasons: [] },
    network: { outcome: 'allow', reasons: [] },
    yolo: { active: true, mode: 'workspace' },
    criticalAlwaysConfirm: false,
    scriptTrust: 'trusted',
  };
}
