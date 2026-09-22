import type { BrowserActionInput } from '../../protocol/src/browser.js';
import { MAX_WAIT_FOR_MS } from '../../browser/src/driver.js';
import { AevraToolError } from './errors.js';

const MAX_SCRIPT_CHARS = 32_768;
const MAX_SCRIPT_STEPS = 32;
const MAX_SELECTOR_CHARS = 2_048;
const MAX_TEXT_CHARS = 65_536;
const MAX_KEY_CHARS = 128;
const QUOTED = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;

function invalid(message: string): never {
  throw new AevraToolError('INVALID_REQUEST', `browser_execute_script: ${message}`);
}

function decodeQuoted(raw: string): string {
  const quote = raw[0];
  if ((quote !== '"' && quote !== "'") || raw.at(-1) !== quote) invalid('invalid string literal');
  let out = '';
  for (let index = 1; index < raw.length - 1; index += 1) {
    const char = raw[index]!;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = raw[++index];
    if (next === undefined) invalid('unterminated escape');
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === 'v') out += '\v';
    else if (next === '0') out += '\0';
    else if (next === '\\' || next === '"' || next === "'") out += next;
    else if (next === 'u') {
      const hex = raw.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) invalid('invalid unicode escape');
      out += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    } else {
      invalid(`unsupported escape \\${next}`);
    }
  }
  return out;
}

function boundedText(raw: string, label: string, max: number): string {
  const value = decodeQuoted(raw);
  if (value.length > max) invalid(`${label} exceeds ${max} characters`);
  return value;
}

function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < script.length; index += 1) {
    const char = script[index]!;
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth -= 1;
    if (depth < 0) invalid('unbalanced delimiters');
    if (char === ';' && depth === 0) {
      const statement = script.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  if (quote || depth !== 0) invalid('unterminated string or unbalanced delimiters');
  const tail = script.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function timeout(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 5_000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_WAIT_FOR_MS) {
    invalid(`timeout must be an integer between 1 and ${MAX_WAIT_FOR_MS}`);
  }
  return value;
}

function parseStatement(source: string): BrowserActionInput {
  const statement = source.replace(/^await\s+/, '').trim();
  let match = new RegExp(`^page\\.locator\\(\\s*${QUOTED}\\s*\\)\\.click\\(\\s*\\)$`).exec(
    statement,
  );
  if (match) {
    return { op: 'click', selector: boundedText(match[1]!, 'selector', MAX_SELECTOR_CHARS) };
  }

  match = new RegExp(
    `^page\\.locator\\(\\s*${QUOTED}\\s*\\)\\.(fill|type)\\(\\s*${QUOTED}\\s*\\)$`,
  ).exec(statement);
  if (match) {
    return {
      op: 'type',
      selector: boundedText(match[1]!, 'selector', MAX_SELECTOR_CHARS),
      text: boundedText(match[3]!, 'text', MAX_TEXT_CHARS),
      clear: match[2] === 'fill',
    };
  }

  match = new RegExp(
    `^page\\.locator\\(\\s*${QUOTED}\\s*\\)\\.waitFor\\(\\s*(?:\\{\\s*timeout\\s*:\\s*(\\d+)\\s*\\})?\\s*\\)$`,
  ).exec(statement);
  if (match) {
    return {
      op: 'wait_for',
      selector: boundedText(match[1]!, 'selector', MAX_SELECTOR_CHARS),
      timeoutMs: timeout(match[2]),
    };
  }

  match = new RegExp(
    `^page\\.getByText\\(\\s*${QUOTED}\\s*\\)\\.waitFor\\(\\s*(?:\\{\\s*timeout\\s*:\\s*(\\d+)\\s*\\})?\\s*\\)$`,
  ).exec(statement);
  if (match) {
    return {
      op: 'wait_for',
      text: boundedText(match[1]!, 'text', MAX_TEXT_CHARS),
      timeoutMs: timeout(match[2]),
    };
  }

  match = new RegExp(`^page\\.keyboard\\.press\\(\\s*${QUOTED}\\s*\\)$`).exec(statement);
  if (match) {
    return { op: 'press_key', key: boundedText(match[1]!, 'key', MAX_KEY_CHARS) };
  }

  invalid(
    'unsupported statement; allowed forms are locator(...).click(), locator(...).fill(), locator(...).type(), locator(...).waitFor(), getByText(...).waitFor(), and keyboard.press()',
  );
}

/**
 * Parses a deliberately non-Turing-complete Playwright-like subset. This is a
 * compact transport syntax only: no JavaScript is evaluated and every parsed
 * statement becomes an ordinary BrowserActionInput that still passes through
 * Aevra DLP, origin policy, approvals, credential guards, auditing, and the
 * driver's serialized session lock.
 */
export function parseBrowserScript(value: unknown): BrowserActionInput[] {
  if (typeof value !== 'string' || !value.trim()) invalid('script must be a non-empty string');
  if (value.length > MAX_SCRIPT_CHARS) invalid(`script exceeds ${MAX_SCRIPT_CHARS} characters`);
  const statements = splitStatements(value);
  if (statements.length === 0) invalid('script must contain at least one statement');
  if (statements.length > MAX_SCRIPT_STEPS) {
    invalid(`script may contain at most ${MAX_SCRIPT_STEPS} statements`);
  }
  return statements.map(parseStatement);
}
