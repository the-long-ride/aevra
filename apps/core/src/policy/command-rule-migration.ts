import type { CommandRuleV2 } from '../../../../packages/protocol/src/command-analysis.js';
import type { PermissionRepository } from '../../../../packages/store/src/permissions.js';

export interface MigrationResult {
  ruleId: string;
  status: 'active' | 'needs-review';
  predicate?: CommandRuleV2;
  reason?: string;
}

export function convertLegacyMatcher(matcher: string, _effect: 'allow' | 'deny'): MigrationResult {
  const norm = matcher.trim();

  // Broad shell wildcards cannot grant unattended V2 authority
  if (norm.startsWith('shell:') || norm === '*' || norm === '*:*') {
    return {
      ruleId: '',
      status: 'needs-review',
      reason: 'Broad shell or wildcard matcher requires operator review for V2 conversion',
    };
  }

  const parts = norm.split(':').filter(Boolean);
  const app = parts[0]?.toLowerCase();

  // If application is unknown or empty
  if (!app) {
    return {
      ruleId: '',
      status: 'needs-review',
      reason: 'Empty or malformed matcher',
    };
  }

  // Git narrow patterns: git:status, git:diff, git:log, git:show
  if (app === 'git') {
    const sub = parts[1]?.toLowerCase();
    if (!sub || sub === '*') {
      return {
        ruleId: '',
        status: 'needs-review',
        reason: 'Broad git wildcard matcher requires operator review',
      };
    }
    const predicate: CommandRuleV2 = {
      version: 2,
      application: 'git',
      operation: [sub],
      allowedModifiers: [],
      allowedOptions: [],
      positionalConstraint: 'workspace-paths',
      targetScope: 'workspace',
      backends: ['host'],
      dialects: ['direct', 'bash', 'pwsh', 'cmd'],
      executableFingerprint: '*',
      wrapperFingerprints: ['*'],
    };
    return { ruleId: '', status: 'active', predicate };
  }

  // Node package patterns: npm:run:dev, pnpm:audit, etc.
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(app)) {
    const sub = parts[1]?.toLowerCase();
    if (!sub || sub === '*') {
      return {
        ruleId: '',
        status: 'needs-review',
        reason: 'Broad package manager wildcard matcher requires operator review',
      };
    }
    const scriptName = sub === 'run' ? parts[2] : undefined;
    const predicate: CommandRuleV2 = {
      version: 2,
      application: app,
      operation: [sub, ...(scriptName ? [scriptName] : [])],
      scriptName,
      allowedModifiers: [],
      allowedOptions: [],
      positionalConstraint: 'workspace-paths',
      targetScope: 'workspace',
      backends: ['host'],
      dialects: ['direct', 'bash', 'pwsh', 'cmd'],
      executableFingerprint: '*',
      wrapperFingerprints: ['*'],
    };
    return { ruleId: '', status: 'active', predicate };
  }

  // Broad fallback
  return {
    ruleId: '',
    status: 'needs-review',
    reason: `Legacy matcher '${matcher}' is too broad for automatic V2 migration`,
  };
}

export function migratePermissionRules(repo: PermissionRepository): {
  migratedCount: number;
  needsReviewCount: number;
} {
  const rules = repo.list();
  let migratedCount = 0;
  let needsReviewCount = 0;

  for (const rule of rules) {
    if (rule.capability !== 'commands.run') continue;
    if (rule.version && rule.version >= 2 && rule.predicate_json) continue;

    const conversion = convertLegacyMatcher(rule.matcher, rule.effect);
    if (conversion.status === 'active' && conversion.predicate) {
      repo.upsert({
        ...rule,
        version: 2,
        predicate: conversion.predicate,
        status: 'active',
      });
      migratedCount++;
    } else {
      repo.upsert({
        ...rule,
        version: 1,
        status: 'needs-review',
      });
      needsReviewCount++;
    }
  }

  return { migratedCount, needsReviewCount };
}
