import type { Capability, RiskTier } from '../../protocol/src/index.js';
import type { McpRuntimeContext } from './service-types.js';

export function commandTextOf(args: any): string | undefined {
  if (typeof args?.script === 'string') return args.script;
  const command = args?.command;
  if (!command || typeof command !== 'object') return undefined;
  return [command.executable, ...(Array.isArray(command.args) ? command.args : [])]
    .filter((value) => typeof value === 'string')
    .join(' ');
}

export function criticalConfirmRequired(context: McpRuntimeContext, risk: RiskTier) {
  return (
    risk === 'CRITICAL' &&
    context.deps.settings?.get<boolean>('policy.critical.alwaysConfirm', false) === true
  );
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
  if (criticalConfirmRequired(context, operation.risk)) return false;
  const mode =
    context.deps.settings?.get<{ mode?: string }>('policy.yolo', { mode: 'unrestricted' })?.mode ??
    'unrestricted';
  return mode === 'unrestricted' || operation.risk !== 'CRITICAL';
}
