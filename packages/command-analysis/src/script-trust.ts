import { computeScriptTrustFingerprint } from './fingerprint.js';

export type ScriptTrustStatus = 'not-applicable' | 'trusted' | 'unapproved' | 'changed';

export interface ScriptTrustEvaluation {
  status: ScriptTrustStatus;
  fingerprint?: string;
  previousFingerprint?: string;
  scriptBody?: string;
  reason?: string;
}

export function evaluateScriptTrust(
  scriptName: string,
  packageJsonText?: string | null,
  recordedFingerprint?: string,
): ScriptTrustEvaluation {
  if (!packageJsonText) {
    return { status: 'unapproved', reason: 'PACKAGE_JSON_MISSING' };
  }

  let pkg: any;
  try {
    pkg = JSON.parse(packageJsonText);
  } catch {
    return { status: 'unapproved', reason: 'PACKAGE_JSON_INVALID' };
  }

  const scripts = pkg.scripts ?? {};
  const scriptBody = scripts[scriptName];
  if (typeof scriptBody !== 'string') {
    return { status: 'unapproved', reason: 'SCRIPT_NOT_FOUND' };
  }

  const lifecycle: Record<string, string> = {};
  const pre = scripts[`pre${scriptName}`];
  if (typeof pre === 'string') lifecycle[`pre${scriptName}`] = pre;
  const post = scripts[`post${scriptName}`];
  if (typeof post === 'string') lifecycle[`post${scriptName}`] = post;

  const packageConfig: Record<string, unknown> = {};
  if (pkg.packageManager) packageConfig.packageManager = pkg.packageManager;
  if (pkg.type) packageConfig.type = pkg.type;

  const fingerprint = computeScriptTrustFingerprint(
    scriptName,
    scriptBody,
    lifecycle,
    packageConfig,
  );

  if (!recordedFingerprint) {
    return { status: 'unapproved', fingerprint, scriptBody };
  }

  if (recordedFingerprint === fingerprint) {
    return { status: 'trusted', fingerprint, scriptBody };
  }

  return {
    status: 'changed',
    fingerprint,
    previousFingerprint: recordedFingerprint,
    scriptBody,
    reason: 'SCRIPT_CHANGED',
  };
}
