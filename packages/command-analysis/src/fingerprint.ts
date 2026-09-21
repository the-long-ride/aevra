import { createHash } from 'node:crypto';
import type { AnalysisContext, CommandRequest } from './types.js';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function computeRequestFingerprint(request: CommandRequest): string {
  const payload = JSON.stringify({
    kind: request.kind,
    executable: request.executable,
    argv: request.argv,
    script: request.script,
    shell: request.shell,
    cwdLogical: request.cwdLogical ?? '/',
    env: request.env ?? {},
    executionMode: request.executionMode,
    networkDestinations: request.networkDestinations ?? [],
  });
  return sha256(payload);
}

export function computeEvidenceFingerprint(
  requestFingerprint: string,
  executableFingerprint: string,
  context: AnalysisContext,
  extra: Record<string, unknown> = {},
): string {
  const payload = JSON.stringify({
    requestFingerprint,
    executableFingerprint,
    rootsRevision: context.rootsRevision,
    backendRevision: context.backendRevision,
    policyRevision: context.policyRevision,
    environmentFingerprint: context.environmentFingerprint,
    resolverGeneration: context.resolverGeneration,
    ...extra,
  });
  return sha256(payload);
}

export function computeScriptTrustFingerprint(
  scriptName: string,
  scriptBody: string,
  lifecycleScripts: Record<string, string> = {},
  packageConfig: Record<string, unknown> = {},
): string {
  const payload = JSON.stringify({
    scriptName,
    scriptBody,
    lifecycleScripts,
    packageConfig,
  });
  return sha256(payload);
}
