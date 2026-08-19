import type { Capability, RiskTier } from '../../../../packages/protocol/src/index.js';
import type { PermissionRepository } from '../../../../packages/store/src/permissions.js';

export type RuleScope = 'once' | 'session' | 'workspace' | 'global';
export type RuleEffect = 'allow' | 'deny';
export interface PermissionRule {
  id: string;
  effect: RuleEffect;
  capability: Capability;
  scope: RuleScope;
  workspaceId?: string;
  actor?: string;
  sessionId?: string;
  matcher: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}
export interface PermissionDecision {
  outcome: 'allow' | 'deny' | 'approval';
  ruleId?: string;
  reason: string;
}
export interface PermissionSummary {
  effectiveCapabilities: Capability[];
  commandMatchers: string[];
}

const scopeScore: Record<RuleScope, number> = { global: 1, workspace: 2, session: 3, once: 4 };
const capabilityOrder: Capability[] = [
  'files.read',
  'files.search',
  'git.read',
  'files.write',
  'files.delete',
  'commands.run',
  'git.commit',
  'git.push',
  'network',
];

function matcherScore(m: string) {
  return m.split(/[:/*]/).filter(Boolean).length * 10 + (m.includes('*') ? 0 : 5);
}
function matches(pattern: string, value: string) {
  if (pattern === value) return true;
  const re = new RegExp(
    '^' +
      pattern
        .split('*')
        .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
  return re.test(value);
}
function fromRow(r: any): PermissionRule {
  return {
    id: r.id,
    effect: r.effect,
    capability: r.capability,
    scope: r.scope,
    workspaceId: r.workspace_id ?? r.workspaceId,
    actor: r.actor ?? undefined,
    sessionId: r.session_id ?? r.sessionId,
    matcher: r.matcher,
    createdAt: r.created_at ?? r.createdAt,
    expiresAt: r.expires_at ?? r.expiresAt,
  };
}
function specificityScore(rule: PermissionRule) {
  return scopeScore[rule.scope] * 100 + matcherScore(rule.matcher);
}
function specificity(a: PermissionRule, b: PermissionRule) {
  const sa = specificityScore(a),
    sb = specificityScore(b);
  if (sa !== sb) return sb - sa;
  if (a.effect !== b.effect) return a.effect === 'deny' ? -1 : 1;
  return a.id.localeCompare(b.id);
}

export class PermissionEngine {
  constructor(private repo: PermissionRepository) {}

  private applicable(input: { workspaceId?: string; actor?: string; sessionId?: string }) {
    const now = Date.now();
    return (this.repo.list() as any[])
      .map(fromRow)
      .filter(
        (r) =>
          (!r.expiresAt || Date.parse(r.expiresAt) > now) &&
          (!r.actor || r.actor === input.actor) &&
          (!r.workspaceId || r.workspaceId === input.workspaceId) &&
          (!r.sessionId || r.sessionId === input.sessionId),
      );
  }

  decide(input: {
    capability: Capability;
    matcher: string;
    workspaceId?: string;
    actor?: string;
    sessionId?: string;
    risk: RiskTier;
  }): PermissionDecision {
    const matched = this.applicable(input)
      .filter((r) => r.capability === input.capability && matches(r.matcher, input.matcher))
      .sort(specificity)[0];
    if (matched?.effect === 'deny')
      return {
        outcome: 'deny',
        ruleId: matched.id,
        reason: `matched ${matched.scope} deny rule`,
      };
    if (input.risk === 'CRITICAL')
      return {
        outcome: 'approval',
        reason: 'critical operations require one-time local authorization',
      };
    if (!matched) return { outcome: 'approval', reason: 'no remembered permission rule' };
    return {
      outcome: 'allow',
      ruleId: matched.id,
      reason: `matched ${matched.scope} allow rule`,
    };
  }

  summary(input: {
    workspaceId?: string;
    actor?: string;
    sessionId?: string;
    baselineCapabilities: Capability[];
  }): PermissionSummary {
    const rules = this.applicable(input);
    const baseline = new Set<Capability>(input.baselineCapabilities);
    const effective = new Set<Capability>();
    const commandMatchers: string[] = [];

    for (const capability of capabilityOrder) {
      const capabilityRules = rules.filter((r) => r.capability === capability),
        denies = capabilityRules.filter((r) => r.effect === 'deny'),
        allows = capabilityRules.filter((r) => r.effect === 'allow');
      const wildcardDenied = denies.some((r) => r.matcher === '*');
      if (baseline.has(capability) && !wildcardDenied) effective.add(capability);
      if (capability === 'commands.run') {
        for (const matcher of [...new Set(allows.map((r) => r.matcher))]) {
          if (denies.some((r) => matches(r.matcher, matcher))) continue;
          commandMatchers.push(matcher);
        }
        if (commandMatchers.length) effective.add('commands.run');
        continue;
      }
      if (!wildcardDenied && allows.some((r) => r.matcher === '*')) effective.add(capability);
    }
    return {
      effectiveCapabilities: capabilityOrder.filter((capability) => effective.has(capability)),
      commandMatchers,
    };
  }
}
