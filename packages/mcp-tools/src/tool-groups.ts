import { AevraToolError } from './errors.js';

export const TOOL_GROUPS = [
  'files',
  'commands',
  'git',
  'changes',
  'skills',
  'browser',
  'desktop',
  'control',
  'upstream',
] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];
export const RESULT_FORMATS = ['both', 'text', 'structured'] as const;
export type ResultFormat = (typeof RESULT_FORMATS)[number];
export interface ConnectorProfile {
  toolGroups?: ToolGroup[];
  resultFormat?: ResultFormat;
}

// Mirrors splitProxyName: `<server>__<tool>` where server is a lowercase slug.
const UPSTREAM = /^[a-z0-9][a-z0-9-]{0,31}__/;
const CORE_PREFIXES = ['workspace_', 'operation_', 'approval_'];

export function toolGroupOf(name: string): 'core' | ToolGroup {
  if (UPSTREAM.test(name)) return 'upstream';
  if (name === 'aevra_status' || name === 'control_access_status') return 'core';
  if (CORE_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'core';
  if (name === 'search' || name.startsWith('file_')) return 'files';
  if (name === 'shell_run' || name.startsWith('command_run') || name.startsWith('process_')) {
    return 'commands';
  }
  if (name.startsWith('git_')) return 'git';
  if (name.startsWith('change_')) return 'changes';
  if (name === 'skills_list' || name.startsWith('skill_') || name.startsWith('instructions_')) {
    return 'skills';
  }
  if (name.startsWith('browser_')) return 'browser';
  if (name.startsWith('desktop_')) return 'desktop';
  if (name.startsWith('control_')) return 'control';
  return 'core';
}

export function isGroupEnabled(
  group: 'core' | ToolGroup,
  groups: readonly ToolGroup[] | undefined,
): boolean {
  return group === 'core' || groups === undefined || groups.includes(group);
}

export function assertToolGroupEnabled(
  name: string,
  groups: readonly ToolGroup[] | undefined,
): void {
  const group = toolGroupOf(name);
  if (isGroupEnabled(group, groups)) return;
  throw new AevraToolError(
    'TOOL_GROUP_DISABLED',
    `Tool ${name} is in the "${group}" group, which is disabled for this connector. Enable it under Connections > Tool surface.`,
  );
}
