const MAX_STRING = 2_000;
const WORD_WINDOW = 128;
const MAX_ITEMS = 50;
const MAX_KEYS = 200;
const MAX_DEPTH = 8;

function cutString(text: string): string {
  if (text.length <= MAX_STRING) return text;
  let end = MAX_STRING;
  for (let i = MAX_STRING; i > MAX_STRING - WORD_WINDOW; i -= 1) {
    if (/\s/.test(text[i - 1] ?? '')) {
      end = i - 1;
      break;
    }
  }
  return `${text.slice(0, end)}… [${text.length - end} more chars]`;
}

/**
 * Copies a value for the activity log with hard size limits, so logging a huge
 * result stays cheap. Cutting at whitespace keeps a secret from being split into
 * a fragment the redactor would no longer recognise.
 */
export function boundedClone(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return cutString(value);
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'object':
      break;
    default:
      return null;
  }
  if (depth >= MAX_DEPTH) return '[depth limit]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => boundedClone(item, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`… ${value.length - MAX_ITEMS} more items`);
    return items;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, MAX_KEYS)) out[key] = boundedClone(item, depth + 1);
  if (entries.length > MAX_KEYS) out['…'] = `${entries.length - MAX_KEYS} more keys`;
  return out;
}
