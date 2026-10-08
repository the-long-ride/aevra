import { isRecord, type Json } from './common.js';

const SUMMARY_MAX = 200;
const KEPT = [
  'id',
  'state',
  'risk',
  'capability',
  'family',
  'tool',
  'scope',
  'workspaceId',
  'expiresAt',
] as const;
const SUMMARY_KEYS = ['summary', 'description', 'title', 'command', 'path'] as const;

export function isApprovalTicket(value: unknown): value is Json {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.state === 'string' &&
    isRecord(value.operation)
  );
}

function describe(operation: Json): string {
  for (const key of SUMMARY_KEYS) {
    const text = operation[key];
    if (typeof text === 'string' && text) return text;
  }
  return '';
}

/** Decision-relevant fields only; the full ticket stays available via `detail: "full"`. */
export function summariseTicket(ticket: Json): Json {
  const operation = ticket.operation as Json;
  const out: Json = {};
  for (const key of KEPT) {
    const value = ticket[key] ?? operation[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  const text = describe(operation);
  if (text) out.summary = text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
  return out;
}
