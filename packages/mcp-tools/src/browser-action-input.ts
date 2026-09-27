import type { BrowserActionInput } from '../../protocol/src/browser.js';
import { AevraToolError } from './errors.js';

const OPERATIONS = ['click', 'drag', 'type', 'press_key', 'scroll', 'select', 'wait_for'] as const;
type Operation = (typeof OPERATIONS)[number];

const FIELDS: Record<Operation, readonly string[]> = {
  click: ['ref', 'selector', 'x', 'y'],
  drag: ['x', 'y', 'toX', 'toY'],
  type: ['ref', 'selector', 'text', 'clear'],
  press_key: ['key'],
  scroll: ['ref', 'selector', 'x', 'y', 'dx', 'dy'],
  select: ['ref', 'selector', 'value'],
  wait_for: ['ref', 'selector', 'text', 'timeoutMs'],
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(index: number, message: string): never {
  throw new AevraToolError('INVALID_REQUEST', `actions[${index}]: ${message}`);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Accept the documented flat form and the one-key form some MCP clients emit. */
export function normalizeBrowserActions(value: unknown): BrowserActionInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((input, index) => {
    if (!object(input)) fail(index, 'action must be an object');
    let op: Operation;
    let fields: Record<string, unknown>;
    if ('op' in input) {
      if (!OPERATIONS.includes(input.op as Operation)) fail(index, 'unknown op');
      op = input.op as Operation;
      fields = { ...input };
      delete fields.op;
    } else {
      const keys = Object.keys(input);
      if (keys.length !== 1 || !OPERATIONS.includes(keys[0] as Operation)) {
        fail(index, 'expected exactly one operation key');
      }
      op = keys[0] as Operation;
      if (!object(input[op])) fail(index, `${op} must contain an object`);
      fields = input[op] as Record<string, unknown>;
    }
    for (const key of Object.keys(fields)) {
      if (!FIELDS[op].includes(key)) fail(index, `unexpected ${key} for ${op}`);
    }
    const target = nonempty(fields.ref) || nonempty(fields.selector);
    if ('ref' in fields && !nonempty(fields.ref)) fail(index, 'ref must be a nonempty string');
    if ('selector' in fields && !nonempty(fields.selector)) {
      fail(index, 'selector must be a nonempty string');
    }
    const hasX = 'x' in fields;
    const hasY = 'y' in fields;
    if (hasX !== hasY || (hasX && (!finite(fields.x) || !finite(fields.y)))) {
      fail(index, 'x and y must be a pair of finite numbers');
    }
    if ((op === 'click' || op === 'scroll') && !target && !hasX) {
      fail(index, `${op} requires a ref, selector, or coordinate pair`);
    }
    if (op === 'drag' && (!hasX || !finite(fields.toX) || !finite(fields.toY))) {
      fail(index, 'drag requires finite x, y, toX and toY');
    }
    if ((op === 'type' || op === 'select') && !target) {
      fail(index, `${op} requires a ref or selector`);
    }
    if (op === 'press_key' && !nonempty(fields.key)) fail(index, 'press_key requires key');
    if (op === 'type') {
      if (typeof fields.text !== 'string') fail(index, 'type requires text');
      if ('clear' in fields && typeof fields.clear !== 'boolean') {
        fail(index, 'clear must be a boolean');
      }
    }
    if (op === 'select' && typeof fields.value !== 'string') {
      fail(index, 'select requires value');
    }
    if (op === 'scroll' && (!finite(fields.dx) || !finite(fields.dy))) {
      fail(index, 'scroll requires finite dx and dy');
    }
    if (op === 'wait_for') {
      if (!target && !nonempty(fields.text)) fail(index, 'wait_for requires a target or text');
      if (!finite(fields.timeoutMs) || fields.timeoutMs < 0) {
        fail(index, 'wait_for requires nonnegative timeoutMs');
      }
    }
    return { op, ...fields } as BrowserActionInput;
  });
}
