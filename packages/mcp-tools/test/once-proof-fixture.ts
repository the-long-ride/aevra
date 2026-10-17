import type { CapabilityApprovalProof } from '../src/service-types.js';

export function onceProof(key?: string): CapabilityApprovalProof | undefined {
  if (!key) return undefined;
  const [sessionId, capability, matcher] = key.split('\0');
  return {
    kind: 'capability',
    requestId: 'approved request',
    sessionId: sessionId!,
    capability: capability as CapabilityApprovalProof['capability'],
    matcher: matcher!,
    risk: 'HIGH',
    binding: 'test invocation',
    consumed: true,
  };
}
