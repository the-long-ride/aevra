import { argsHash } from './service-helpers.js';
import { AevraToolError } from './errors.js';
import type { CapabilityApprovalProof } from './service-types.js';

export function claimCapabilityProof(
  proof: CapabilityApprovalProof,
  sessionId: string,
  original: unknown,
) {
  if (proof.consumed || proof.sessionId !== sessionId || proof.binding !== argsHash(original)) {
    throw new AevraToolError(
      'APPROVAL_CONTEXT_CHANGED',
      'Capability approval does not match this invocation',
    );
  }
  proof.consumed = true;
  return proof;
}
