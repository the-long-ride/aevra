import type { CommandEffect, RiskTier } from '../../../../packages/protocol/src/index.js';
import { classifyOperationRisk } from './risk.js';
export interface CommandClassification {
  family: string;
  effect: CommandEffect;
  risk: RiskTier;
  outputKeys: string[];
}
export function classifyCommand(command: string | string[]): CommandClassification {
  const argv = Array.isArray(command)
    ? command
    : [...command.matchAll(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)].map((m) =>
        m[0]!.replace(/^['"]|['"]$/g, ''),
      );
  const exe = (argv[0] ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? 'unknown',
    sub = (argv[1] ?? '').toLowerCase();
  let family = `${exe}:${sub || 'run'}`,
    effect: CommandEffect = 'UNKNOWN',
    outputs: string[] = [];
  const shellExe = ['bash', 'sh', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(exe);
  if (shellExe && ['-lc', '-c', '-command', '-nologo'].includes(sub)) {
    family =
      exe.startsWith('power') || exe.startsWith('pwsh') ? 'shell:powershell' : `shell:${exe}`;
    const detected = classifyOperationRisk(family, argv.slice(1));
    return { family, effect, risk: detected === 'CRITICAL' ? 'CRITICAL' : 'HIGH', outputKeys: [] };
  }
  if (exe === 'git') {
    if (['status', 'diff', 'log', 'show', 'branch'].includes(sub)) {
      effect = 'READ_ONLY';
    } else if (['checkout', 'switch', 'merge', 'rebase', 'reset', 'clean'].includes(sub)) {
      effect = 'REPOSITORY_STATE';
    } else effect = 'SOURCE_MUTATION';
  } else if (['npm', 'pnpm', 'yarn'].includes(exe)) {
    if (['test', 'lint'].includes(sub)) {
      family = `${exe}:${sub}`;
      effect = 'BUILD_OUTPUT';
      outputs = ['node_modules/.cache', 'coverage'];
    } else if (['install', 'add', 'ci', 'update'].includes(sub)) {
      family = 'package:install';
      effect = 'BUILD_OUTPUT';
      outputs = ['node_modules', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
    } else effect = 'UNKNOWN';
  } else if (exe === 'cargo') {
    if (['test', 'check', 'build'].includes(sub)) {
      effect = 'BUILD_OUTPUT';
      outputs = ['target'];
    } else if (sub === 'fmt') effect = 'SOURCE_MUTATION';
  } else if (exe === 'dotnet') {
    if (['test', 'build', 'restore'].includes(sub)) {
      effect = 'BUILD_OUTPUT';
      outputs = ['bin', 'obj'];
    } else if (sub === 'format') effect = 'SOURCE_MUTATION';
  } else if (['grep', 'rg', 'cat', 'type', 'ls', 'dir'].includes(exe)) effect = 'READ_ONLY';
  return {
    family,
    effect,
    risk: classifyOperationRisk(family, argv.slice(1)),
    outputKeys: outputs,
  };
}
