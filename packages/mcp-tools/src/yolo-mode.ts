import { normalizeYoloMode, type Capability, type RiskTier } from '../../protocol/src/index.js';
import type { McpRuntimeContext } from './service-types.js';

export function commandTextOf(args: any): string | undefined {
  if (typeof args?.script === 'string') return args.script;
  const command = args?.command;
  if (!command || typeof command !== 'object') return undefined;
  return [command.executable, ...(Array.isArray(command.args) ? command.args : [])]
    .filter((value) => typeof value === 'string')
    .join(' ');
}

export function criticalConfirmRequired(
  context: McpRuntimeContext,
  risk: RiskTier,
  sessionId?: string,
) {
  if (risk !== 'CRITICAL') return false;
  if (sessionId && context.sessions.isYolo?.(sessionId)) return true;
  return context.deps.settings?.get<boolean>('policy.critical.alwaysConfirm', false) === true;
}

export function yoloAllows(
  context: McpRuntimeContext,
  sessionId: string,
  operation: {
    capability: Capability;
    risk: RiskTier;
    family: string;
    executionMode?: unknown;
    networkDestinations?: unknown;
    commandText?: string;
  },
) {
  if (!context.sessions.isYolo?.(sessionId)) return false;
  if (criticalConfirmRequired(context, operation.risk, sessionId)) return false;
  const mode = normalizeYoloMode(
    context.deps.settings?.get<{ mode?: string }>('policy.yolo', { mode: 'workspace' })?.mode,
  );
  return mode === 'unrestricted' || operation.risk !== 'CRITICAL';
}
