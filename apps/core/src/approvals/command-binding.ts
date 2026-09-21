import { createHash } from 'node:crypto';
import type { CommandAnalysis } from '../../../../packages/protocol/src/command-analysis.js';

export interface CommandApprovalBinding {
  ticketId: string;
  sessionId: string;
  workspaceId: string;
  requestFingerprint: string;
  evidenceFingerprint: string;
  securityFingerprint: string;
  createdAt: string;
  consumed: boolean;
}

const bindings = new Map<string, CommandApprovalBinding>();

function securityFingerprint(analysis: CommandAnalysis): string {
  if (!analysis.context || !Array.isArray(analysis.nodes)) {
    return analysis.evidenceFingerprint;
  }
  const payload = JSON.stringify({
    requestFingerprint: analysis.requestFingerprint,
    rootsRevision: analysis.context.rootsRevision,
    backendRevision: analysis.context.backendRevision,
    policyRevision: analysis.context.policyRevision,
    environmentFingerprint: analysis.context.environmentFingerprint,
    resolverGeneration: analysis.context.resolverGeneration,
    scope: analysis.scope,
    parseStatus: analysis.parseStatus,
    nodes: analysis.nodes.map((node) => ({
      application: node.application,
      argv: node.argv,
      executableFingerprint: node.executable?.fingerprint ?? null,
      executableCanonicalPath: node.executable?.canonicalPath ?? null,
      wrapperFingerprints: node.wrappers.map((wrapper) => wrapper.identity.fingerprint),
      wrapperCanonicalPaths: node.wrappers.map((wrapper) => wrapper.identity.canonicalPath),
      canonicalCwdCandidates: node.canonicalCwdCandidates ?? [],
      scriptFingerprint: node.scriptFingerprint ?? null,
      risk: node.risk,
      scope: node.scope,
      targets: node.targets.map((target) => ({
        path: target.path,
        access: target.access,
        scope: target.scope,
        canonicalPath: target.canonicalPath ?? null,
      })),
    })),
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function bindCommandApproval(
  ticketId: string,
  analysis: CommandAnalysis,
  sessionId: string,
  workspaceId: string,
): CommandApprovalBinding {
  const binding: CommandApprovalBinding = {
    ticketId,
    sessionId,
    workspaceId,
    requestFingerprint: analysis.requestFingerprint,
    evidenceFingerprint: analysis.evidenceFingerprint,
    securityFingerprint: securityFingerprint(analysis),
    createdAt: new Date().toISOString(),
    consumed: false,
  };
  bindings.set(ticketId, binding);
  return binding;
}

export function getCommandApprovalBinding(ticketId: string): CommandApprovalBinding | null {
  return bindings.get(ticketId) ?? null;
}

export function validateCommandApprovalBinding(
  ticketId: string,
  analysis: CommandAnalysis,
): { ok: true } | { ok: false; reason: string } {
  const binding = bindings.get(ticketId);
  if (!binding) {
    return { ok: false, reason: 'Binding not found for ticket' };
  }
  if (binding.consumed) {
    return { ok: false, reason: 'Approval ticket was already consumed' };
  }
  if (
    binding.requestFingerprint !== analysis.requestFingerprint ||
    binding.securityFingerprint !== securityFingerprint(analysis)
  ) {
    return { ok: false, reason: 'Evidence or context changed since approval' };
  }
  return { ok: true };
}

export function consumeCommandApproval(
  ticketId: string,
  analysis: CommandAnalysis,
): { ok: true } | { ok: false; reason: string } {
  const validation = validateCommandApprovalBinding(ticketId, analysis);
  if (!validation.ok) return validation;
  bindings.delete(ticketId);
  return { ok: true };
}

export function deleteCommandApprovalBinding(ticketId: string): void {
  bindings.delete(ticketId);
}

export function clearExpiredBindings(maxAgeMs = 15 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, binding] of bindings.entries()) {
    if (now - Date.parse(binding.createdAt) > maxAgeMs) {
      bindings.delete(id);
    }
  }
}
