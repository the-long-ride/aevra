import { parse as parseToml, stringify } from 'smol-toml';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import type { Product } from './types.js';

export type ConfigFormat = 'toml' | 'json' | 'jsonc';
export function parseConfig(text: string, kind: ConfigFormat): Record<string, any> {
  if (kind === 'toml')
    return parseToml(text, { integersAsBigInt: 'asNeeded' }) as Record<string, any>;
  const errors: ParseError[] = [];
  const result = parse(text || '{}', errors, {
    allowTrailingComma: kind === 'jsonc',
    disallowComments: kind === 'json',
  });
  if (errors.length || !result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('AGENT_CONFIG_INVALID: expected a valid configuration object');
  return result;
}

function tomlSection(kind: ConfigFormat, entryPath: string[]): string {
  if (kind === 'toml' && entryPath.length !== 1)
    throw new Error('AGENT_CONFIG_INVALID: TOML entry path must have one segment');
  if (!entryPath.length) throw new Error('AGENT_CONFIG_INVALID: empty entry path');
  return entryPath[0];
}

export function configEntry(
  text: string,
  kind: ConfigFormat,
  entryPath: string[],
  product: Product,
): unknown {
  tomlSection(kind, entryPath);
  let node: unknown = parseConfig(text, kind);
  for (const [index, segment] of entryPath.entries()) {
    if (!Object.hasOwn(node as object, segment)) return undefined;
    node = (node as Record<string, unknown>)[segment];
    if (!node || typeof node !== 'object' || Array.isArray(node))
      throw new Error(
        `AGENT_CONFIG_INVALID: ${entryPath.slice(0, index + 1).join('.')} must be an object`,
      );
  }
  return Object.hasOwn(node as object, product)
    ? (node as Record<string, unknown>)[product]
    : undefined;
}

export function editConfig(
  text: string,
  kind: ConfigFormat,
  entryPath: string[],
  product: Product,
  entry?: Record<string, unknown>,
): string {
  const section = tomlSection(kind, entryPath);
  configEntry(text, kind, entryPath, product); // parses and validates the parent chain
  if (kind !== 'toml') {
    const result = applyEdits(
      text || '{}\n',
      modify(text || '{}\n', [...entryPath, product], entry, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
      }),
    );
    parseConfig(result, kind);
    return result;
  }
  const start = `# BEGIN ${product} managed MCP\n`;
  const end = `# END ${product} managed MCP\n`;
  const normalized = text.replaceAll('\r\n', '\n');
  const from = normalized.indexOf(start);
  const to = normalized.indexOf(end);
  if (from < 0 !== to < 0 || (from >= 0 && to < from))
    throw new Error('AGENT_CONFIG_CONFLICT: invalid managed markers');
  const cleared =
    from < 0 ? normalized : normalized.slice(0, from) + normalized.slice(to + end.length);
  if (!entry) {
    parseConfig(cleared, kind);
    return cleared;
  }
  const block = stringify({ [section]: { [product]: entry } } as any);
  const result = `${cleared}${cleared && !cleared.endsWith('\n') ? '\n' : ''}${start}${block}${end}`;
  parseConfig(result, kind);
  return result;
}
