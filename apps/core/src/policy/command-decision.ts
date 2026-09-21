import type {
  AnalysisContext,
  CommandDecision,
  CommandNode,
  CommandPolicyInput,
  CommandRuleV2,
  Reason,
} from '../../../../packages/protocol/src/command-analysis.js';
import { isCommandRuleV2 } from './command-rule-validation.js';
import { buildSuggestedRule } from './command-rule-suggestion.js';
export { buildSuggestedRule };

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function matchesRule(rule: CommandRuleV2, node: CommandNode, context: AnalysisContext): boolean {
  if (!isCommandRuleV2(rule)) return false;
  if (rule.application !== node.application) return false;

  if (rule.operation.length > 0) {
    if (node.operation.length < rule.operation.length) return false;
    for (let i = 0; i < rule.operation.length; i++) {
      if (rule.operation[i] !== '*' && rule.operation[i] !== node.operation[i]) return false;
    }
  }

  if (rule.scriptName && rule.scriptName !== node.scriptName) return false;

  const allowedModifiers = new Set(rule.allowedModifiers);
  for (const modifier of node.modifiers) {
    if (!allowedModifiers.has(modifier) && !allowedModifiers.has('*')) return false;
  }

  for (const option of node.options) {
    const allowed =
      rule.allowedOptions.find((entry) => entry.name === option.name) ??
      rule.allowedOptions.find((entry) => entry.name === '*');
    if (!allowed) return false;
    if (allowed.values) {
      if (option.value === undefined) return false;
      if (!allowed.values.includes(option.value) && !allowed.values.includes('*')) return false;
    }
  }

  if (rule.positionalConstraint === 'exact') {
    if (!rule.exactArgv || !sameStrings(rule.exactArgv, node.argv)) return false;
  } else if (node.targets.some((target) => target.scope !== 'inside')) {
    return false;
  }

  const backends = new Set(rule.backends);
  if (!backends.has(context.backendId) && !backends.has('*')) return false;

  const dialects = new Set<string>(rule.dialects);
  if (!dialects.has(node.dialect)) return false;

  if (rule.executableFingerprint !== '*') {
    if (!node.executable?.fingerprint) return false;
    if (rule.executableFingerprint !== node.executable.fingerprint) return false;
  }

  if (!rule.wrapperFingerprints.includes('*')) {
    const current = node.wrappers.map((wrapper) => wrapper.identity.fingerprint);
    if (!sameStrings(rule.wrapperFingerprints, current)) return false;
  }

  if (rule.scriptFingerprint !== undefined) {
    if (!node.scriptFingerprint || rule.scriptFingerprint !== node.scriptFingerprint) return false;
  }

  if (rule.targetScope === 'workspace' && node.scope !== 'inside') return false;
  return true;
}

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

  // YOLO is deliberately broad for ordinary commands, but CRITICAL remains an
  // immutable human-confirmation boundary. An exact approved fingerprint may
  // resume the critical command; otherwise a fresh approval is mandatory.
  if (yolo.active && hasCriticalNode) {
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

  // Active YOLO overrides remembered command/network allow/deny policy for
  // non-critical commands within the configured scope. Workspace mode requires
  // conclusive inside-workspace analysis; unrestricted mode removes that Aevra
  // workspace authorization boundary.
  if (yolo.active && yolo.mode === 'unrestricted') {
    return { outcome: 'allow', analysis, ruleIds: [] };
  }
  if (yolo.active && yolo.mode === 'workspace' && analysis.scope === 'inside') {
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
    if (!yolo.active || yolo.mode !== 'unrestricted') {
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
    if (!yolo.active || yolo.mode !== 'unrestricted') {
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
    if (!yolo.active || yolo.mode !== 'unrestricted') {
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
  }

  // 11. Network approval
  if (input.network?.outcome === 'approval') {
    if (!yolo.active || yolo.mode !== 'unrestricted') {
      return {
        outcome: 'approval',
        reasons: [...reasons, ...input.network.reasons],
        analysis,
        suggestedRules: [],
      };
    }
  }

  // 12. Typed allow rules evaluation
  const matchedRuleIds: string[] = [];
  let allNodesCovered = analysis.nodes.length > 0;

  for (const node of analysis.nodes) {
    const matchingRule = applicableRules.find(
      (r) => r.effect === 'allow' && matchesRule(r.predicate, node, analysis.context),
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
