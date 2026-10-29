import {
  normalizeYoloPolicy,
  type Capability,
  type RiskTier,
  type YoloPolicy,
} from '../../protocol/src/index.js';
import type { McpRuntimeContext } from './service-types.js';

export function commandTextOf(args: any): string | undefined {
  if (typeof args?.script === 'string') return args.script;
  const command = args?.command;
  if (!command || typeof command !== 'object') return undefined;
  return [command.executable, ...(Array.isArray(command.args) ? command.args : [])]
    .filter((value) => typeof value === 'string')
    .join(' ');
}

/** The stored YOLO policy (scope `mode` plus `risk`), normalized. */
export function readYoloPolicy(context: McpRuntimeContext): YoloPolicy {
  return normalizeYoloPolicy(
    context.deps.settings?.get<Record<string, unknown>>('policy.yolo', { mode: 'workspace' }),
  );
}

/** True when this session is YOLO and the operator chose the `do-whatever` risk level. */
export function yoloDoesWhatever(context: McpRuntimeContext, sessionId: string): boolean {
  if (!sessionId || !context.sessions.isYolo?.(sessionId)) return false;
  return readYoloPolicy(context).risk === 'do-whatever';
}

export function criticalConfirmRequired(
  context: McpRuntimeContext,
  risk: RiskTier,
  sessionId?: string,
) {
  if (risk !== 'CRITICAL') return false;
  if (sessionId && context.sessions.isYolo?.(sessionId)) {
    return !yoloDoesWhatever(context, sessionId);
  }
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
  return yoloDoesWhatever(context, sessionId) || operation.risk !== 'CRITICAL';
}
