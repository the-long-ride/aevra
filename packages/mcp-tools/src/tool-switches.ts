import { AevraToolError } from './errors.js';
import type { SettingsReader } from './service-types.js';
import { toolGroupOf } from './tool-groups.js';

export const TOOL_SWITCH_SETTING = 'tools.disabled';

/** Core tools (status, workspace, approvals, operations) can never be switched off. */
export function isToolLocked(name: string): boolean {
  return toolGroupOf(name) === 'core';
}

/** Stored names, locked ones filtered out; tolerates any malformed stored value. */
export function disabledToolNames(settings?: Pick<SettingsReader, 'get'>): ReadonlySet<string> {
  const stored = settings?.get<unknown>(TOOL_SWITCH_SETTING, { names: [] });
  const names =
    stored && typeof stored === 'object' && Array.isArray((stored as { names?: unknown }).names)
      ? ((stored as { names: unknown[] }).names as unknown[])
      : [];
  return new Set(
    names.filter((name): name is string => typeof name === 'string' && !isToolLocked(name)),
  );
}

export function assertToolEnabled(name: string, disabled: ReadonlySet<string>): void {
  if (!disabled.has(name)) return;
  throw new AevraToolError('TOOL_DISABLED', `Tool ${name} is turned off in Settings > Tools.`);
}

export function withoutDisabledTools<T extends { name: string }>(
  tools: readonly T[],
  disabled: ReadonlySet<string>,
): T[] {
  return disabled.size ? tools.filter((tool) => !disabled.has(tool.name)) : [...tools];
}

/** Reads the live set from a service that exposes it; absent means nothing is disabled. */
export function serviceDisabledTools(service: unknown): ReadonlySet<string> {
  const read = (service as { disabledToolNames?: () => ReadonlySet<string> } | null)
    ?.disabledToolNames;
  return typeof read === 'function' ? read.call(service) : new Set();
}
