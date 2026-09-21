import type {
  CommandNode,
  CommandRuleV2,
} from '../../../../packages/protocol/src/command-analysis.js';
export function buildSuggestedRule(node: CommandNode): CommandRuleV2 {
  return {
    version: 2,
    application: node.application,
    operation: node.operation,
    scriptName: node.scriptName,
    allowedModifiers: node.modifiers,
    allowedOptions: (node.options ?? []).map((o) => ({ name: o.name })),
    positionalConstraint: 'workspace-paths',
    targetScope: 'workspace',
    backends: ['host'],
    dialects: [node.dialect],
    executableFingerprint: node.executable?.fingerprint ?? '*',
    wrapperFingerprints: (node.wrappers ?? []).map((w) => w.identity.fingerprint),
    scriptFingerprint: node.scriptFingerprint,
  };
}
