// Pure helpers that turn recorded MCP activity payloads into something a person
// can read: unwrap the MCP result envelope, survive server-side truncation, and
// pull the actual command lines and their output out of command tools.

type Json = Record<string, unknown>;

export type ParsedDetail =
  | { ok: true; value: unknown; truncated: boolean }
  | { ok: false; text: string; truncated: boolean };

export interface CommandCall {
  line: string;
  cwd?: string;
  mode?: string;
  shell?: string;
  timeoutMs?: number;
}

export interface CommandResult {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  timedOut?: boolean;
  signal?: string;
  error?: string;
}

/** Suffix the core activity log appends when it cuts a payload at its size cap. */
const TRUNCATION_MARKER = '\n… [truncated]';

const COMMAND_TOOLS = new Set(['command_run', 'command_run_many', 'shell_run', 'process_start']);

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Closes whatever strings, arrays and objects a hard cut left open. */
function repairJson(text: string): string {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if (ch === '}' || ch === ']') closers.pop();
  }
  let out = text;
  if (inString) {
    if (escaped) out = out.slice(0, -1);
    out = `${out.replace(/\\u[0-9a-fA-F]{0,3}$/, '')}"`;
  }
  out = out.replace(/[\s,]+$/, '').replace(/:\s*$/, ': null');
  return out + closers.reverse().join('');
}

export function parseDetail(raw: string | undefined): ParsedDetail | undefined {
  if (raw === undefined) return undefined;
  const truncated = raw.endsWith(TRUNCATION_MARKER);
  const text = truncated ? raw.slice(0, -TRUNCATION_MARKER.length) : raw;
  const direct = tryParse(text);
  if (direct.ok) return { ok: true, value: direct.value, truncated };
  if (truncated) {
    const repaired = tryParse(repairJson(text));
    if (repaired.ok) return { ok: true, value: repaired.value, truncated };
  }
  return { ok: false, text, truncated };
}

function isTextPart(part: unknown): part is { type: 'text'; text: string } {
  return isRecord(part) && part.type === 'text' && typeof part.text === 'string';
}

/** Unwraps `{ content: [{ type: 'text', text }], structuredContent }` tool results. */
export function unwrapMcpResult(value: unknown): { data: unknown; isError: boolean } {
  if (!isRecord(value) || !Array.isArray(value.content) || !value.content.every(isTextPart)) {
    return { data: value, isError: false };
  }
  const isError = value.isError === true;
  const text = value.content.map((part) => part.text).join('\n');
  const parsed = tryParse(text);
  if (parsed.ok) return { data: parsed.value, isError };
  if ('structuredContent' in value) return { data: value.structuredContent, isError };
  const repaired = tryParse(repairJson(text));
  return { data: repaired.ok ? repaired.value : text, isError };
}

function quoteArg(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function normalizeCommand(item: unknown): CommandCall | null {
  if (!isRecord(item)) return null;
  const source = isRecord(item.command) ? item.command : item;
  const executable = str(source.executable);
  if (!executable) return null;
  const args = Array.isArray(source.args) ? source.args.map(String) : [];
  return compact({
    line: [executable, ...args].map(quoteArg).join(' '),
    cwd: str(source.cwdLogical ?? item.cwdLogical),
    mode: str(item.executionMode),
    timeoutMs: num(source.timeoutMs ?? item.timeoutMs),
  });
}

/** The command lines a tool call asked to run, or null for non-command tools. */
export function extractCommands(action: string, input: unknown): CommandCall[] | null {
  if (!COMMAND_TOOLS.has(action) || !isRecord(input)) return null;
  if (action === 'shell_run') {
    const script = str(input.script);
    if (!script) return null;
    return [
      compact({
        line: script,
        shell: str(input.shell),
        cwd: str(input.cwdLogical),
        mode: str(input.executionMode),
        timeoutMs: num(input.timeoutMs),
      }),
    ];
  }
  if (action === 'command_run_many') {
    if (!Array.isArray(input.commands)) return null;
    const commands = input.commands.map(normalizeCommand);
    return commands.every(Boolean) ? (commands as CommandCall[]) : null;
  }
  const command = normalizeCommand(input);
  return command ? [command] : null;
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    const text = [str(error.code), str(error.message)].filter(Boolean).join(': ');
    return text || JSON.stringify(error);
  }
  return 'Command failed';
}

/** Peels `{ ok, value }` / `{ ok: false, error }` wrappers the executor adds. */
function unwrapOk(value: unknown): { value: unknown } | { error: string } {
  let current = value;
  while (isRecord(current) && typeof current.ok === 'boolean') {
    if (current.ok === false) return { error: errorText(current.error) };
    if (!('value' in current)) break;
    current = current.value;
  }
  return { value: current };
}

function toResult(value: unknown): CommandResult | null {
  const unwrapped = unwrapOk(value);
  if ('error' in unwrapped) return { error: unwrapped.error };
  const result = unwrapped.value;
  if (!isRecord(result)) return null;
  if (isRecord(result.error)) return { error: errorText(result.error) };
  if (!('exitCode' in result) && !('stdout' in result) && !('stderr' in result)) return null;
  return compact({
    exitCode: num(result.exitCode),
    stdout: typeof result.stdout === 'string' ? result.stdout : undefined,
    stderr: typeof result.stderr === 'string' ? result.stderr : undefined,
    durationMs: num(result.durationMs),
    timedOut: typeof result.timedOut === 'boolean' ? result.timedOut : undefined,
    signal: str(result.signal),
  });
}

/** What each command printed, in command order, or null when output is not a command result. */
export function extractCommandResults(action: string, data: unknown): CommandResult[] | null {
  if (!COMMAND_TOOLS.has(action)) return null;
  if (action === 'command_run_many' && isRecord(data) && Array.isArray(data.results)) {
    const ordered = [...data.results].sort(
      (a, b) =>
        (num(isRecord(a) ? a.index : undefined) ?? 0) -
        (num(isRecord(b) ? b.index : undefined) ?? 0),
    );
    return ordered.map((child) => toResult(child) ?? { error: 'No command result recorded' });
  }
  const result = toResult(data);
  return result ? [result] : null;
}

export function tailLines(text: string, count: number) {
  const trimmed = text.replace(/\r?\n$/, '');
  const lines = trimmed === '' ? [] : trimmed.split(/\r?\n/);
  return {
    text: lines.slice(-count).join('\n'),
    hidden: Math.max(0, lines.length - count),
    total: lines.length,
  };
}
