import type {
  AnalysisContext,
  CommandDecision,
  CommandPolicyInput,
  Reason,
} from '../../../../packages/protocol/src/command-analysis.js';
import { matchesRule } from './command-rule-match.js';
import { buildSuggestedRule } from './command-rule-suggestion.js';
export { buildSuggestedRule };

function isRuleApplicable(
  rule: CommandPolicyInput['rules'][number],
  context: AnalysisContext,
  nowIso = new Date().toISOString(),
): boolean {
  if (rule.expiresAt && rule.expiresAt < nowIso) return false;
  if (rule.scope === 'session') {
    if (!rule.sessionId || rule.sessionId !== context.sessionId) return false;
  }
  if (rule.scope === 'workspace') {
    if (!rule.workspaceId || rule.workspaceId !== context.workspaceId) return false;
  }
  if (rule.actor && rule.actor !== context.actor) {
    return false;
  }
  return true;
}

function exactApprovalDecision(input: CommandPolicyInput): CommandDecision | null {
  const { analysis, exactApproval } = input;
  if (!exactApproval) return null;
  if (exactApproval.consumed) {
    return {
      outcome: 'deny',
      reasons: [{ code: 'APPROVAL_ALREADY_CONSUMED', message: 'Approval was already consumed' }],
      analysis,
    };
  }
  if (
    exactApproval.requestFingerprint !== analysis.requestFingerprint ||
    exactApproval.evidenceFingerprint !== analysis.evidenceFingerprint
  ) {
    return {
      outcome: 'approval',
      reasons: [
        {
          code: 'CONTEXT_CHANGED',
          message: 'Command evidence or context changed since ticket approval',
        },
      ],
      analysis,
      suggestedRules: [],
    };
  }
  if (exactApproval.authorityVerified) {
    return { outcome: 'allow', analysis, ruleIds: [exactApproval.ticketId] };
  }
  return null;
}

export function decideCommand(input: CommandPolicyInput): CommandDecision {
  const { analysis, yolo, scriptTrust } = input;
  const reasons: Reason[] = [...analysis.reasons];

  // Invalid authority and malformed requests are structural failures, not
  // approval policy, so YOLO never bypasses them.
  if (!input.authority.valid) {
    return { outcome: 'deny', reasons: input.authority.reasons, analysis };
  }
  if (analysis.parseStatus === 'invalid') {
    return { outcome: 'invalid', reasons, analysis };
  }

  const hasCriticalNode = analysis.nodes.some((n) => n.risk === 'CRITICAL');
  const exactDecision = exactApprovalDecision(input);

  // Two YOLO axes: risk (prevent-high-risk | do-whatever) and mode (scope).
  // Under prevent-high-risk, CRITICAL remains a human-confirmation boundary. An
  // exact approved fingerprint may resume the critical command; otherwise a fresh
  // approval is mandatory. do-whatever lifts that boundary but not the scope.
  const doWhatever = yolo.active && yolo.risk === 'do-whatever';
  const scopeLifted = yolo.active && yolo.mode === 'unrestricted';
  if (yolo.active && hasCriticalNode && !doWhatever) {
    if (exactDecision) return exactDecision;
    return {
      outcome: 'approval',
      reasons: [
        {
          code: 'CRITICAL_OPERATION',
          message: 'Critical operations require mandatory operator confirmation',
        },
      ],
      analysis,
      suggestedRules: analysis.nodes.map(buildSuggestedRule),
    };
  }

  // do-whatever overrides remembered allow/deny, network, script trust and
  // unsupported-syntax checks within the configured scope. Workspace scope needs
  // conclusive inside-workspace analysis; unrestricted scope has no scope limit.
  // Inside-workspace work is allowed in both scopes (unrestricted is a superset of
  // workspace); unrestricted only adds the outside-workspace reach.
  if (doWhatever && scopeLifted) {
    return { outcome: 'allow', analysis, ruleIds: [] };
  }
  if (yolo.active && analysis.scope === 'inside') {
    return { outcome: 'allow', analysis, ruleIds: [] };
  }

  // Outside the active YOLO scope, ordinary permission policy still applies.
  if (input.selectedLegacyDecision?.outcome === 'deny') {
    return {
      outcome: 'deny',
      reasons: [{ code: 'SELECTED_DENY', message: input.selectedLegacyDecision.reason }],
      analysis,
    };
  }

  const applicableRules = input.rules.filter((r) => isRuleApplicable(r, analysis.context));
  for (const node of analysis.nodes) {
    const matchingDeny = applicableRules.find(
      (r) => r.effect === 'deny' && matchesRule(r.predicate, node, analysis.context),
    );
    if (matchingDeny) {
      return {
        outcome: 'deny',
        reasons: [{ code: 'TYPED_DENY', message: `Command matched deny rule: ${matchingDeny.id}` }],
        analysis,
      };
    }
  }

  if (input.network?.outcome === 'deny') {
    return { outcome: 'deny', reasons: input.network.reasons, analysis };
  }

  if (!input.authority.commandCapability) {
    return {
      outcome: 'approval',
      reasons: [...reasons, ...input.authority.reasons],
      analysis,
      suggestedRules: analysis.nodes.map(buildSuggestedRule),
    };
  }

  if (exactDecision) return exactDecision;

  if (hasCriticalNode) {
    return {
      outcome: 'approval',
      reasons: [
        {
          code: 'CRITICAL_OPERATION',
          message: 'Critical operations require mandatory operator confirmation',
        },
      ],
      analysis,
      suggestedRules: analysis.nodes.map(buildSuggestedRule),
    };
  }

  // Parsed-but-unsupported shell constructs must never gain reusable trust
  // through typed allow rules or YOLO. Exact approved evidence was handled above.
  if (analysis.parseStatus === 'partial' || analysis.parseStatus === 'unsupported') {
    return {
      outcome: 'approval',
      reasons: [
        ...reasons,
        {
          code: 'UNSUPPORTED_SYNTAX',
          message: 'Command contains syntax that cannot be fully authorized statically',
        },
      ],
      analysis,
      suggestedRules: [],
    };
  }

  // 9. Scope check (outside / unknown)
  if (analysis.scope === 'outside') {
    if (!scopeLifted) {
      return {
        outcome: 'approval',
        reasons: [
          ...reasons,
          {
            code: 'OUTSIDE_WORKSPACE',
            message: 'Command leaves authorized workspace roots and requires approval',
          },
        ],
        analysis,
        suggestedRules: [],
      };
    }
  }

  if (analysis.scope === 'unknown') {
    if (!scopeLifted) {
      return {
        outcome: 'approval',
        reasons: [
          ...reasons,
          {
            code: 'DYNAMIC_SCOPE',
            message: 'Dynamic or unresolvable command scope requires approval',
          },
        ],
        analysis,
        suggestedRules: [],
      };
    }
  }

  // 10. Script trust
  if (scriptTrust === 'unapproved') {
    return {
      outcome: 'approval',
      reasons: [
        {
          code: 'SCRIPT_EVIDENCE_REQUIRED',
          message: 'Project script evidence is unavailable or has not been approved',
        },
      ],
      analysis,
      suggestedRules: analysis.nodes.map(buildSuggestedRule),
    };
  }
  if (scriptTrust === 'changed') {
    return {
      outcome: 'approval',
      reasons: [
        {
          code: 'SCRIPT_CHANGED',
          message: 'Project script definition changed since prior approval',
        },
      ],
      analysis,
      suggestedRules: analysis.nodes.map(buildSuggestedRule),
    };
  }

  // 11. Network approval
  if (input.network?.outcome === 'approval') {
    return {
      outcome: 'approval',
      reasons: [...reasons, ...input.network.reasons],
      analysis,
      suggestedRules: [],
    };
  }

  // 12. Typed allow rules evaluation
  const matchedRuleIds: string[] = [];
  let allNodesCovered = analysis.nodes.length > 0;

  for (const node of analysis.nodes) {
    const matchingRule = applicableRules.find(
      (r) =>
        r.effect === 'allow' &&
        r.predicate.explicitEnvFingerprint === node.explicitEnvFingerprint &&
        matchesRule(r.predicate, node, analysis.context),
    );
    if (matchingRule) {
      matchedRuleIds.push(matchingRule.id);
    } else {
      allNodesCovered = false;
    }
  }

  if (allNodesCovered) {
    return { outcome: 'allow', analysis, ruleIds: matchedRuleIds };
  }

  // prevent-high-risk + unrestricted: every guard above passed, so an ordinary
  // unmatched command runs without a remembered rule.
  if (scopeLifted) {
    return { outcome: 'allow', analysis, ruleIds: [] };
  }

  // 13. Unmatched ordinary command requires approval
  return {
    outcome: 'approval',
    reasons: [
      {
        code: 'NO_REMEMBERED_RULE',
        message: 'No remembered typed rule covers this command',
      },
    ],
    analysis,
    suggestedRules: analysis.nodes.map(buildSuggestedRule),
  };
}
