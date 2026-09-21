import type { CommandRuleV2, Dialect } from '../../../../packages/protocol/src/command-analysis.js';

const DIALECTS = new Set<Dialect>(['direct', 'pwsh', 'powershell', 'cmd', 'bash', 'sh', 'zsh']);

export type CommandRuleValidation =
  { ok: true; value: CommandRuleV2 } | { ok: false; message: string };

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function validateCommandRuleV2(value: unknown): CommandRuleValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'Typed command predicate must be an object' };
  }
  const rule = value as Record<string, unknown>;

  if (rule.version !== 2)
    return { ok: false, message: 'Typed command predicate version must be 2' };
  if (typeof rule.application !== 'string' || rule.application.length === 0) {
    return { ok: false, message: 'Typed command predicate requires application' };
  }
  if (!stringArray(rule.operation)) {
    return { ok: false, message: 'Typed command predicate operation must be a string array' };
  }
  if (!stringArray(rule.allowedModifiers)) {
    return { ok: false, message: 'allowedModifiers must be a string array' };
  }
  if (!Array.isArray(rule.allowedOptions)) {
    return { ok: false, message: 'allowedOptions must be an array' };
  }
  for (const option of rule.allowedOptions) {
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      return { ok: false, message: 'allowedOptions entries must be objects' };
    }
    const entry = option as Record<string, unknown>;
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      return { ok: false, message: 'allowedOptions entries require a name' };
    }
    if (entry.values !== undefined && !stringArray(entry.values)) {
      return { ok: false, message: 'allowedOptions values must be string arrays' };
    }
  }

  if (rule.positionalConstraint !== 'exact' && rule.positionalConstraint !== 'workspace-paths') {
    return { ok: false, message: 'positionalConstraint must be exact or workspace-paths' };
  }
  if (rule.exactArgv !== undefined && !stringArray(rule.exactArgv)) {
    return { ok: false, message: 'exactArgv must be a string array' };
  }
  if (rule.positionalConstraint === 'exact' && !stringArray(rule.exactArgv)) {
    return { ok: false, message: 'exact positionalConstraint requires exactArgv' };
  }
  if (rule.targetScope !== 'workspace') {
    return { ok: false, message: 'targetScope must be workspace' };
  }
  if (!stringArray(rule.backends) || rule.backends.length === 0) {
    return { ok: false, message: 'backends must be a non-empty string array' };
  }
  if (
    !Array.isArray(rule.dialects) ||
    rule.dialects.length === 0 ||
    !rule.dialects.every(
      (dialect) => typeof dialect === 'string' && DIALECTS.has(dialect as Dialect),
    )
  ) {
    return { ok: false, message: 'dialects contains an unsupported dialect' };
  }
  if (typeof rule.executableFingerprint !== 'string' || rule.executableFingerprint.length === 0) {
    return { ok: false, message: 'executableFingerprint must be a non-empty string' };
  }
  if (!stringArray(rule.wrapperFingerprints)) {
    return { ok: false, message: 'wrapperFingerprints must be a string array' };
  }
  if (rule.scriptName !== undefined && typeof rule.scriptName !== 'string') {
    return { ok: false, message: 'scriptName must be a string' };
  }
  if (rule.scriptFingerprint !== undefined && typeof rule.scriptFingerprint !== 'string') {
    return { ok: false, message: 'scriptFingerprint must be a string' };
  }

  return { ok: true, value: value as CommandRuleV2 };
}

export function isCommandRuleV2(value: unknown): value is CommandRuleV2 {
  return validateCommandRuleV2(value).ok;
}
