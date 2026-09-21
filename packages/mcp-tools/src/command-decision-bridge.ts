import { createHash } from 'node:crypto';
import type {
  AnalysisContext,
  CommandAnalysis,
  CommandDecision,
  CommandPolicyInput,
  CommandRequest,
} from '../../protocol/src/command-analysis.js';
import { analyzeCommand } from '../../command-analysis/src/analyze.js';
import { buildChildEnvironment } from '../../security/src/environment.js';
import { decideCommand } from '../../../apps/core/src/policy/command-decision.js';
import { maxRisk, oneTimeAllowed, requiredLease } from './service-helpers.js';
import { createAnalysisServices } from './command-analysis-services.js';
export { createAnalysisServices };
import type { McpRuntimeContext } from './service-types.js';

function stableFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function evaluateAndDecideCommand(
  context: McpRuntimeContext,
  sessionId: string,
  input: {
    commandRequest: CommandRequest;
    permissionMatcher: string;
    rawDestinations: string[];
    isYolo: boolean;
    yoloMode: 'workspace' | 'unrestricted';
    networkApproval?: any;
    legacyDecision?: { outcome: 'allow' | 'deny' | 'approval'; reason: string };
    riskFloor?: import('../../protocol/src/index.js').RiskTier;
  },
): Promise<{
  analysis: CommandAnalysis;
  decision: CommandDecision;
}> {
  const session = context.sessions.get(sessionId);
  if (!session) {
    throw Object.assign(new Error('Session required'), { code: 'UNAUTHORIZED' });
  }
  const lease = requiredLease(context, sessionId);

  const workspace = context.workspaces?.getLocal
    ? context.workspaces.getLocal(lease.workspaceId)
    : null;
  const workspaceRoot = workspace?.hostRoot;
  const roots = context.workspaces?.capabilityRoots
    ? context.workspaces.capabilityRoots(lease.workspaceId)
    : [];
  const platform =
    process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';

  const rawRules = context.deps.permissions?.listRules?.() ?? [];
  const childEnv = buildChildEnvironment(input.commandRequest.env ?? {}, process.env, platform);
  const rootsRevision = stableFingerprint(
    roots
      .map((root) => ({
        id: root.id,
        logicalPrefix: root.logicalPrefix,
        hostRoot: root.hostRoot,
        capabilities: [...(root.capabilities ?? [])].sort(),
      }))
      .sort((a, b) =>
        String(a.id ?? a.logicalPrefix).localeCompare(String(b.id ?? b.logicalPrefix)),
      ),
  );
  const executionSettings = context.deps.settings?.get<Record<string, unknown>>(
    'execution.settings',
    {},
  );
  const analysisContext: AnalysisContext = {
    actor: session.actor,
    sessionId,
    workspaceId: lease.workspaceId,
    workspaceRoot,
    roots,
    rootsRevision,
    platform,
    backendId: input.commandRequest.executionMode,
    backendRevision: stableFingerprint({
      mode: input.commandRequest.executionMode,
      executionSettings,
    }),
    policyRevision: stableFingerprint(
      rawRules.map((rule: any) => ({
        id: rule.id,
        effect: rule.effect,
        capability: rule.capability,
        scope: rule.scope,
        matcher: rule.matcher,
        predicate_json: rule.predicate_json,
        workspaceId: rule.workspaceId,
        actor: rule.actor,
        sessionId: rule.sessionId,
        status: rule.status,
        expiresAt: rule.expiresAt,
      })),
    ),
    environmentFingerprint: stableFingerprint(
      Object.entries(childEnv).sort(([a], [b]) => a.localeCompare(b)),
    ),
    resolverGeneration: stableFingerprint({
      path: childEnv.PATH ?? childEnv.Path ?? '',
      pathExt: childEnv.PATHEXT ?? '',
      platform,
    }),
  };

  const services = createAnalysisServices(
    workspaceRoot,
    roots,
    platform,
    input.commandRequest.env ?? {},
  );
  const analysis = await analyzeCommand(input.commandRequest, analysisContext, services);
  if (input.riskFloor) {
    for (const node of analysis.nodes) {
      node.risk = maxRisk(
        node.risk as import('../../protocol/src/index.js').RiskTier,
        input.riskFloor,
      );
    }
  }

  let scriptTrust: CommandPolicyInput['scriptTrust'] = 'not-applicable';
  const scriptNodes = analysis.nodes.filter((n) => Boolean(n.scriptName));
  if (scriptNodes.length > 0) {
    const applicableAllowRules = rawRules
      .filter(
        (r: any) =>
          r.version === 2 &&
          r.predicate_json &&
          r.effect === 'allow' &&
          r.capability === 'commands.run' &&
          r.status !== 'needs-review' &&
          (!r.workspaceId || r.workspaceId === lease.workspaceId) &&
          (!r.actor || r.actor === session.actor) &&
          (!r.sessionId || r.sessionId === sessionId) &&
          (!r.expiresAt || r.expiresAt > new Date().toISOString()),
      )
      .map((r: any) => {
        try {
          return JSON.parse(r.predicate_json);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    let anyChanged = false;
    let anyUnknown = false;
    let allTrusted = true;

    for (const sNode of scriptNodes) {
      const approvedFingerprints = applicableAllowRules
        .filter(
          (rule: any) =>
            rule.application === sNode.application &&
            rule.scriptName === sNode.scriptName &&
            rule.scriptFingerprint,
        )
        .map((rule: any) => String(rule.scriptFingerprint));

      if (!sNode.scriptFingerprint) {
        anyUnknown = true;
        allTrusted = false;
      } else if (approvedFingerprints.includes(sNode.scriptFingerprint)) {
        // trusted by at least one applicable remembered rule
      } else if (approvedFingerprints.length > 0) {
        anyChanged = true;
        allTrusted = false;
      } else {
        anyUnknown = true;
        allTrusted = false;
      }
    }

    if (anyChanged) {
      scriptTrust = 'changed';
    } else if (allTrusted) {
      scriptTrust = 'trusted';
    } else if (anyUnknown) {
      scriptTrust = 'unapproved';
    }
  }

  const typedRules: CommandPolicyInput['rules'] = rawRules
    .filter(
      (r: any) =>
        r.version === 2 &&
        r.predicate_json &&
        r.capability === 'commands.run' &&
        !(r.status === 'needs-review' && r.effect === 'allow'),
    )
    .map((r: any) => {
      try {
        return {
          id: r.id,
          effect: r.effect,
          predicate: JSON.parse(r.predicate_json),
          scope: r.scope,
          actor: r.actor,
          sessionId: r.sessionId,
          workspaceId: r.workspaceId,
          expiresAt: r.expiresAt,
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const commandCap =
    Boolean(lease.capabilities?.includes('commands.run')) ||
    input.isYolo ||
    oneTimeAllowed(context, sessionId, 'commands.run', input.permissionMatcher);
  const networkCap = Boolean(lease.capabilities?.includes('network')) || input.isYolo;
  let networkOutcome: 'allow' | 'deny' | 'approval' = 'allow';
  const networkReasons: any[] = [];

  for (const destination of input.rawDestinations) {
    const classified = context.deps.operations?.classifyNetwork?.(destination);
    if (!classified) {
      networkOutcome = 'approval';
      networkReasons.push({
        code: 'NETWORK_DESTINATION_REQUIRED',
        message: `Network destination cannot be classified safely: ${destination}`,
      });
      continue;
    }
    if (classified.known) continue;
    if (oneTimeAllowed(context, sessionId, 'network', classified.family)) continue;

    const current = context.deps.permissions?.decide?.({
      capability: 'network',
      matcher: classified.family,
      workspaceId: lease.workspaceId,
      actor: session.actor,
      sessionId,
      risk: 'MEDIUM',
    });
    if (current?.outcome === 'deny') {
      networkOutcome = 'deny';
      networkReasons.push({
        code: 'NETWORK_DESTINATION_DENIED',
        message: current.reason || `Network destination denied: ${classified.family}`,
      });
      break;
    }
    if (current?.outcome !== 'allow') {
      networkOutcome = 'approval';
      networkReasons.push({
        code: 'NETWORK_DESTINATION_REQUIRED',
        message: `Network destination requires approval: ${classified.family}`,
      });
    }
  }

  if (input.rawDestinations.length > 0 && !networkCap && networkOutcome !== 'deny') {
    networkOutcome = 'approval';
    networkReasons.push({
      code: 'NETWORK_REQUIRED',
      message: 'network capability not granted',
    });
  }

  const decision = decideCommand({
    analysis,
    selectedLegacyDecision: input.legacyDecision,
    rules: typedRules,
    authority: {
      valid: Boolean(session),
      commandCapability: commandCap,
      reasons: commandCap
        ? []
        : [{ code: 'CAPABILITY_MISSING', message: 'commands.run not granted' }],
    },
    network: {
      outcome: networkOutcome,
      reasons: networkReasons,
    },
    yolo: {
      active: input.isYolo,
      mode: input.yoloMode,
    },
    criticalAlwaysConfirm: true,
    scriptTrust,
  });

  return { analysis, decision };
}
