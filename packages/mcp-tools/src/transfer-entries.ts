import { stripUrlDetail } from '../../security/src/dlp.js';
import { AevraToolError } from './errors.js';

const MAX_TRANSFER_ENTRIES = 64;
const MAX_HEADERS_PER_ENTRY = 32;

/** What a ticket may remember about one entry: never bytes, headers or URL queries. */
export interface TransferEntrySummary {
  path: string;
  source: 'inline' | 'url';
  host?: string;
  bytes?: number;
}

export interface ParsedEntry {
  path: string;
  mimeType: string;
  overwrite: boolean;
  /** Base64 text, present for inline entries. */
  content?: string;
  /** Decoded size of the inline content. */
  bytes?: number;
  url?: string;
  host?: string;
  headers?: Record<string, string>;
}

function invalid(message: string): never {
  throw new AevraToolError('INVALID_REQUEST', message);
}

/** Decoded size of strict base64 text, or null when the text is not valid base64. */
function base64ByteLength(text: string): number | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}

function parseHeaders(value: unknown, index: number): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`entries[${index}].headers must be an object of strings`);
  }
  const pairs = Object.entries(value as Record<string, unknown>);
  if (pairs.length > MAX_HEADERS_PER_ENTRY) invalid(`entries[${index}] has too many headers`);
  const out: Record<string, string> = {};
  for (const [name, headerValue] of pairs) {
    if (!/^[A-Za-z0-9-]+$/.test(name) || typeof headerValue !== 'string') {
      invalid(`entries[${index}].headers must be an object of strings`);
    }
    out[name] = headerValue;
  }
  return out;
}

/** Validates the whole batch up front; nothing runs when any entry is malformed. */
export function parseTransferEntries(args: any): ParsedEntry[] {
  const raw = args?.entries;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_TRANSFER_ENTRIES) {
    invalid(`entries must contain 1 to ${MAX_TRANSFER_ENTRIES} items`);
  }
  const seen = new Set<string>();
  return raw.map((item: any, index: number): ParsedEntry => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalid(`entries[${index}] must be an object`);
    }
    const path = item.path;
    if (typeof path !== 'string' || !path.trim() || path.includes('\0')) {
      invalid(`entries[${index}].path must be a non-empty string`);
    }
    if (seen.has(path)) invalid(`Duplicate path in batch: ${path}`);
    seen.add(path);
    const mimeType = item.mimeType;
    if (typeof mimeType !== 'string' || !mimeType.trim() || mimeType.length > 255) {
      invalid(`entries[${index}].mimeType is required`);
    }
    const hasContent = item.content !== undefined;
    const hasUrl = item.url !== undefined;
    if (hasContent === hasUrl) invalid(`entries[${index}] needs exactly one of content or url`);
    const base = { path, mimeType: mimeType.trim(), overwrite: item.overwrite === true };
    if (hasContent) {
      if (typeof item.content !== 'string' || item.encoding !== 'base64') {
        invalid(`entries[${index}] inline content must be a base64 string with encoding "base64"`);
      }
      if (item.headers !== undefined) invalid(`entries[${index}].headers needs a url`);
      const bytes = base64ByteLength(item.content);
      if (bytes === null) invalid(`entries[${index}].content is not valid base64`);
      return { ...base, content: item.content, bytes };
    }
    let parsed: URL;
    try {
      parsed = new URL(String(item.url));
    } catch {
      return invalid(`entries[${index}].url is not a valid URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      invalid(`entries[${index}].url must be http or https`);
    }
    const headers = parseHeaders(item.headers, index);
    return {
      ...base,
      url: parsed.href,
      host: parsed.hostname,
      ...(headers ? { headers } : {}),
    };
  });
}

export function summarizeEntries(entries: ParsedEntry[]): TransferEntrySummary[] {
  return entries.map((entry) =>
    entry.url
      ? { path: entry.path, source: 'url' as const, host: entry.host }
      : { path: entry.path, source: 'inline' as const, bytes: entry.bytes },
  );
}

/** Total number of agent-supplied headers across the batch. */
export function countHeaders(entries: ParsedEntry[]): number {
  return entries.reduce((sum, entry) => sum + Object.keys(entry.headers ?? {}).length, 0);
}

/** The executor passes raw fs codes through, so a missing path may arrive as ENOENT. */
export function isMissingCode(code: unknown): boolean {
  return code === 'NOT_FOUND' || code === 'ENOENT' || code === 'ENOTDIR';
}

function safeUrl(value: unknown): string {
  try {
    const parsed = new URL(String(value));
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '[omitted]';
  }
}

/**
 * The call as hooks may see it: no inline bytes, no header values, no URL query,
 * fragment or userinfo (R3). Returns the same object for every other tool.
 */
export function redactToolArgsForHooks(name: string, args: any): any {
  if (name !== 'files_download') return args;
  const entries = Array.isArray(args?.entries) ? args.entries : [];
  return {
    ...args,
    entries: entries.map((item: any) => {
      if (!item || typeof item !== 'object') return '[omitted]';
      const out: Record<string, unknown> = {
        path: item.path,
        mimeType: item.mimeType,
        overwrite: item.overwrite,
      };
      if (item.content !== undefined) out.content = '[omitted]';
      if (item.url !== undefined) out.url = safeUrl(item.url);
      if (item.headers !== undefined) out.headers = '[omitted]';
      return out;
    }),
  };
}

const MIN_TRANSFER_TIMEOUT_MS = 300_000;
const MAX_TRANSFER_TIMEOUT_MS = 3_600_000;
const ASSUMED_BYTES_PER_SECOND = 512 * 1024;

/** Size-based IPC deadline for one transfer operation: slow-link estimate, clamped. */
export function transferTimeoutMs(bytes: number): number {
  const estimate = Math.ceil(bytes / ASSUMED_BYTES_PER_SECOND) * 1000;
  return Math.min(MAX_TRANSFER_TIMEOUT_MS, Math.max(MIN_TRANSFER_TIMEOUT_MS, estimate));
}

/** The result as after_tool_call hooks may see it: link urls lose their one-time secret. */
export function redactToolResultForHooks(name: string, result: any): any {
  if (name !== 'files_upload' || !Array.isArray(result?.results)) return result;
  return {
    ...result,
    results: result.results.map((item: any) =>
      item && typeof item.url === 'string' ? { ...item, url: stripUrlDetail(item.url) } : item,
    ),
  };
}
