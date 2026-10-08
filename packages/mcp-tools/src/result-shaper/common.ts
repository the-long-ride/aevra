export type Json = Record<string, unknown>;

// Per-response metadata carries frozen approval budgets without exposing an internal field.
const responseBudgets = new WeakMap<object, number>();

export function rememberOutputBudget<T>(value: T, args: unknown): T {
  if (value !== null && typeof value === 'object') responseBudgets.set(value, outputBudget(args));
  return value;
}

export function resultOutputBudget(value: unknown, args: unknown): number {
  return value !== null && typeof value === 'object'
    ? (responseBudgets.get(value) ?? outputBudget(args))
    : outputBudget(args);
}

const DEFAULT_OUTPUT_CHARS = 16_000;
const MIN_OUTPUT_CHARS = 256;
const MAX_OUTPUT_CHARS = 200_000;

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `{ok:true,value:{...}}` and nothing else is a wrapper; anything richer is kept as is. */
export function unwrapOk(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 2 && value.ok === true && isRecord(value.value)) return value.value;
  return value;
}

export function outputBudget(args: unknown): number {
  const raw = isRecord(args) ? args.maxOutputChars : undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_OUTPUT_CHARS;
  return Math.min(MAX_OUTPUT_CHARS, Math.max(MIN_OUTPUT_CHARS, Math.floor(raw)));
}
