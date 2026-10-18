import type {
  CommandRuleV2,
  CommandNode,
  AnalysisContext,
} from '../../../../packages/protocol/src/command-analysis.js';
import { isCommandRuleV2 } from './command-rule-validation.js';

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function matchesRule(
  rule: CommandRuleV2,
  node: CommandNode,
  context: AnalysisContext,
): boolean {
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
