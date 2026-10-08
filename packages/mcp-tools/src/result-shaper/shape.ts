import { estimateTokens } from '../../../protocol/src/token-estimate.js';
import { isApprovalTicket, summariseTicket } from './approval.js';
import { isBatchResult, shapeBatchResult } from './batch.js';
import { looksLikeCommandResult, shapeCommandValue } from './command-output.js';
import { isRecord, resultOutputBudget, unwrapOk } from './common.js';

const APPROVAL_TOOLS = new Set(['approval_status', 'approval_wait']);
const warned = new Set<string>();

function shapeData(tool: string, args: unknown, data: unknown): unknown {
  const budget = resultOutputBudget(data, args);
  if (isBatchResult(data)) return shapeBatchResult(data, budget);
  if (APPROVAL_TOOLS.has(tool) && isApprovalTicket(data)) {
    const full = isRecord(args) && args.detail === 'full';
    return full ? data : summariseTicket(data);
  }
  const inner = unwrapOk(data);
  if (looksLikeCommandResult(inner)) return shapeCommandValue(inner, budget);
  return data;
}

/**
 * The single place tool results are compacted before they reach a client.
 * Defensive: any failure returns the original result unchanged.
 */
export function shapeToolResult(
  tool: string,
  args: unknown,
  data: unknown,
): { data: unknown; savedChars: number; savedTokens: number } {
  try {
    const shaped = shapeData(tool, args, data);
    if (shaped === data) return { data, savedChars: 0, savedTokens: 0 };
    const originalJson = JSON.stringify(data) ?? '';
    const shapedJson = JSON.stringify(shaped) ?? '';
    return {
      data: shaped,
      savedChars: Math.max(0, originalJson.length - shapedJson.length),
      savedTokens: Math.max(0, estimateTokens(originalJson) - estimateTokens(shapedJson)),
    };
  } catch (error) {
    if (!warned.has(tool)) {
      warned.add(tool);
      console.warn(
        `[aevra] result shaper skipped for ${tool}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { data, savedChars: 0, savedTokens: 0 };
  }
}
